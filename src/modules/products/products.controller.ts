import { NextFunction, Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";
import { Product } from "../../types";
import { removeImage } from "../images/imageStorage";

export const productSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().min(1).max(255).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sku: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1),
  retailPrice: z.number().positive(),
  bulkPricingTiers: z.array(z.object({
    minQty: z.number().int().positive(), maxQty: z.number().int().positive().nullable(), price: z.number().positive(),
  })).default([]),
  stock: z.number().int().nonnegative(),
  moq: z.number().int().positive().optional(),
  featured: z.boolean().optional(),
  status: z.enum(["draft", "active", "inactive"]).optional(),
  imageIds: z.array(z.string().uuid()).optional(),
});

function mapProduct(row: RowDataPacket): Product {
  const images = row.image_ids
    ? String(row.image_ids).split(",").filter(Boolean).map((id) => `/api/images/${id}`)
    : [];
  return {
    id: String(row.id), name: row.name, slug: row.slug, sku: row.sku, category: row.category,
    description: row.description, retailPrice: Number(row.retail_price), bulkPricingTiers: [],
    stock: Number(row.stock), moq: Number(row.minimum_order_quantity), images,
    featured: Boolean(row.featured), status: row.status,
  };
}

async function attachBulkPricing(products: Product[]): Promise<Product[]> {
  if (!products.length) return products;
  const placeholders = products.map(() => "?").join(",");
  const [tierRows] = await db.execute<RowDataPacket[]>(
    `SELECT product_id, min_qty, max_qty, price
       FROM bulk_pricing_tiers
      WHERE product_id IN (${placeholders})
      ORDER BY product_id, sort_order, min_qty`,
    products.map((product) => product.id),
  );
  const tiers = new Map<string, Product["bulkPricingTiers"]>();
  for (const row of tierRows) {
    const productId = String(row.product_id);
    const productTiers = tiers.get(productId) || [];
    productTiers.push({ minQty: Number(row.min_qty), maxQty: row.max_qty === null ? null : Number(row.max_qty), price: Number(row.price) });
    tiers.set(productId, productTiers);
  }
  return products.map((product) => ({ ...product, bulkPricingTiers: tiers.get(product.id) || [] }));
}

const productSelect = `SELECT p.*,
  GROUP_CONCAT(pi.id ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC) AS image_ids
  FROM products p LEFT JOIN product_images pi ON pi.product_id = p.id`;

export async function getProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const conditions = ["p.status = 'active'"];
    const params: Array<string | number> = [];
    if (typeof req.query.category === "string" && req.query.category !== "All") {
      conditions.push("p.category = ?"); params.push(req.query.category);
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      conditions.push("(p.name LIKE ? OR p.category LIKE ? OR p.sku LIKE ?)");
      const search = `%${req.query.search.trim()}%`; params.push(search, search, search);
    }
    if (req.query.featured === "true" || req.query.featured === "false") {
      conditions.push("p.featured = ?"); params.push(req.query.featured === "true" ? 1 : 0);
    }
    const sort = req.query.sortBy === "price_asc" ? "p.retail_price ASC"
      : req.query.sortBy === "price_desc" ? "p.retail_price DESC" : "p.created_at DESC";
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
    const offset = (page - 1) * limit;
    const where = ` WHERE ${conditions.join(" AND ")}`;
    const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM products p${where}`, params);
    const [rows] = await db.execute<RowDataPacket[]>(
      `${productSelect}${where} GROUP BY p.id ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, params
    );
    const total = Number(countRows[0]?.total || 0);
    const products = await attachBulkPricing(rows.map(mapProduct));
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
    res.json({ success: true, data: { products, total, page, totalPages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
}

export async function getProductBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${productSelect} WHERE (p.slug = ? OR p.id = ?) AND p.status = 'active' GROUP BY p.id LIMIT 1`,
      [req.params.slug, req.params.slug]
    );
    if (!rows.length) { res.status(404).json({ success: false, message: "Product not found" }); return; }
    const [product] = await attachBulkPricing([mapProduct(rows[0])]);
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({ success: true, data: { product } });
  } catch (error) { next(error); }
}

export async function getAdminProducts(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `${productSelect} GROUP BY p.id ORDER BY p.created_at DESC`,
    );
    const products = await attachBulkPricing(rows.map(mapProduct));
    res.json({ success: true, data: { products, total: products.length, page: 1, totalPages: 1 } });
  } catch (error) { next(error); }
}

export async function createProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  try {
    const parsed = productSchema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      res.status(400).json({ success: false, message: "Invalid product data", errors: parsed.success ? undefined : parsed.error.format() }); return;
    }
    await connection.beginTransaction();
    const data = parsed.data;
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO products
       (name, slug, sku, category, description, retail_price, stock, minimum_order_quantity, featured, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.name, data.slug, data.sku, data.category, data.description, data.retailPrice, data.stock,
       data.moq || 1, data.featured ? 1 : 0, data.status || "active", Number(req.user.id)]
    );
    if (data.imageIds?.length) {
      const placeholders = data.imageIds.map(() => "?").join(",");
      await connection.execute(
        `UPDATE product_images SET product_id = ? WHERE id IN (${placeholders}) AND uploaded_by = ? AND product_id IS NULL`,
        [result.insertId, ...data.imageIds, Number(req.user.id)]
      );
    }
    if (data.bulkPricingTiers?.length) {
      for (let i = 0; i < data.bulkPricingTiers.length; i++) {
        const tier = data.bulkPricingTiers[i];
        await connection.execute(
          `INSERT INTO bulk_pricing_tiers (product_id, min_qty, max_qty, price, sort_order) VALUES (?, ?, ?, ?, ?)`,
          [result.insertId, tier.minQty, tier.maxQty, tier.price, i]
        );
      }
    }
    await connection.commit();
    const [rows] = await db.execute<RowDataPacket[]>(`${productSelect} WHERE p.id = ? GROUP BY p.id`, [result.insertId]);
    const [product] = await attachBulkPricing([mapProduct(rows[0])]);
    res.status(201).json({ success: true, data: { product } });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
}

export async function updateProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  let removedImageIds: string[] = [];
  try {
    const parsed = productSchema.partial().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ success: false, message: "Invalid product data", errors: parsed.error.format() }); return; }
    const fieldMap: Record<string, string> = {
      name: "name", slug: "slug", sku: "sku", category: "category", description: "description",
      retailPrice: "retail_price", stock: "stock", moq: "minimum_order_quantity", featured: "featured", status: "status",
    };
    const updates: string[] = []; const values: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(fieldMap)) {
      const value = parsed.data[key as keyof typeof parsed.data];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        updates.push(`${column} = ?`);
        values.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
      }
    }
    const hasRelationshipUpdates = parsed.data.bulkPricingTiers !== undefined || parsed.data.imageIds !== undefined;
    if (!updates.length && !hasRelationshipUpdates) { res.status(400).json({ success: false, message: "No supported product fields supplied" }); return; }
    await connection.beginTransaction();
    const [existing] = await connection.execute<RowDataPacket[]>("SELECT id FROM products WHERE id = ? FOR UPDATE", [req.params.id]);
    if (!existing.length) { await connection.rollback(); res.status(404).json({ success: false, message: "Product not found" }); return; }
    if (updates.length) {
      values.push(String(req.params.id));
      await connection.execute<ResultSetHeader>(`UPDATE products SET ${updates.join(", ")} WHERE id = ?`, values);
    }
    if (parsed.data.bulkPricingTiers !== undefined) {
      await connection.execute("DELETE FROM bulk_pricing_tiers WHERE product_id = ?", [req.params.id]);
      for (let index = 0; index < parsed.data.bulkPricingTiers.length; index++) {
        const tier = parsed.data.bulkPricingTiers[index];
        await connection.execute(
          "INSERT INTO bulk_pricing_tiers (product_id, min_qty, max_qty, price, sort_order) VALUES (?, ?, ?, ?, ?)",
          [req.params.id, tier.minQty, tier.maxQty, tier.price, index],
        );
      }
    }
    if (parsed.data.imageIds !== undefined && req.user) {
      const desired = parsed.data.imageIds;
      const [removedRows] = desired.length
        ? await connection.execute<RowDataPacket[]>(
            `SELECT id FROM product_images WHERE product_id = ? AND id NOT IN (${desired.map(() => "?").join(",")})`,
            [req.params.id, ...desired],
          )
        : await connection.execute<RowDataPacket[]>("SELECT id FROM product_images WHERE product_id = ?", [req.params.id]);
      removedImageIds = removedRows.map((row) => String(row.id));
      if (removedImageIds.length) {
        await connection.execute(
          `DELETE FROM product_images WHERE id IN (${removedImageIds.map(() => "?").join(",")})`,
          removedImageIds,
        );
      }
      if (desired.length) {
        const placeholders = desired.map(() => "?").join(",");
        await connection.execute(
          `UPDATE product_images SET product_id = ? WHERE id IN (${placeholders}) AND uploaded_by = ? AND (product_id IS NULL OR product_id = ?)`,
          [req.params.id, ...desired, Number(req.user.id), req.params.id],
        );
      }
    }
    await connection.commit();
    const cleanupResults = await Promise.allSettled(removedImageIds.map((id) => removeImage(id)));
    if (cleanupResults.some((result) => result.status === "rejected")) {
      console.error("One or more detached product image files could not be removed", { productId: req.params.id, removedImageIds });
    }
    const [rows] = await db.execute<RowDataPacket[]>(`${productSelect} WHERE p.id = ? GROUP BY p.id`, [req.params.id]);
    const [product] = await attachBulkPricing([mapProduct(rows[0])]);
    res.json({ success: true, data: { product } });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
}

export async function deleteProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [imageRows] = await db.execute<RowDataPacket[]>("SELECT id FROM product_images WHERE product_id = ?", [req.params.id]);
    const [result] = await db.execute<ResultSetHeader>("DELETE FROM products WHERE id = ?", [req.params.id]);
    if (!result.affectedRows) { res.status(404).json({ success: false, message: "Product not found" }); return; }
    await Promise.all(imageRows.map((row) => removeImage(String(row.id))));
    res.json({ success: true, message: "Product deleted" });
  } catch (error) { next(error); }
}
