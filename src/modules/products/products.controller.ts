import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { DataStore } from "../../data/dataStore";
import { Product } from "../../types";

export const productSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  sku: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  retailPrice: z.number().positive(),
  bulkPricingTiers: z.array(z.object({
    minQty: z.number().int().positive(),
    maxQty: z.number().int().positive().nullable(),
    price: z.number().positive(),
  })),
  stock: z.number().int().nonnegative(),
  moq: z.number().int().positive().optional(),
  images: z.array(z.string()),
  featured: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export async function getProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category, search, sortBy, page, limit, featured } = req.query;

    let items = [...DataStore.products];

    if (category && typeof category === "string" && category !== "All") {
      items = items.filter((p) => p.category.toLowerCase() === category.toLowerCase());
    }

    if (search && typeof search === "string") {
      const q = search.toLowerCase();
      items = items.filter(
        (p) => p.name.toLowerCase().includes(q) ||
               p.category.toLowerCase().includes(q) ||
               p.sku.toLowerCase().includes(q)
      );
    }

    if (featured !== undefined) {
      const isFeatured = featured === "true";
      items = items.filter((p) => Boolean(p.featured) === isFeatured);
    }

    if (sortBy && typeof sortBy === "string") {
      if (sortBy === "price_asc") {
        items.sort((a, b) => a.retailPrice - b.retailPrice);
      } else if (sortBy === "price_desc") {
        items.sort((a, b) => b.retailPrice - a.retailPrice);
      } else if (sortBy === "newest") {
        items.reverse();
      }
    }

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || items.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedItems = items.slice(startIndex, startIndex + limitNum);

    res.status(200).json({
      success: true,
      data: {
        products: paginatedItems,
        total: items.length,
        page: pageNum,
        totalPages: Math.ceil(items.length / (limitNum || 1)),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getProductBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { slug } = req.params;
    const product = DataStore.products.find((p) => p.slug === slug || p.id === slug);

    if (!product) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    res.status(200).json({ success: true, data: { product } });
  } catch (error) {
    next(error);
  }
}

export async function createProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = productSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid product data", errors: parse.error.format() });
      return;
    }

    const newProduct: Product = {
      id: String(DataStore.products.length + 1),
      ...parse.data,
    };

    DataStore.products.push(newProduct);
    DataStore.saveProducts();

    res.status(201).json({ success: true, data: { product: newProduct } });
  } catch (error) {
    next(error);
  }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const index = DataStore.products.findIndex((p) => p.id === id || p.slug === id);

    if (index === -1) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    const parse = productSchema.partial().safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid product data", errors: parse.error.format() });
      return;
    }

    DataStore.products[index] = {
      ...DataStore.products[index],
      ...parse.data,
    };
    DataStore.saveProducts();

    res.status(200).json({ success: true, data: { product: DataStore.products[index] } });
  } catch (error) {
    next(error);
  }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const index = DataStore.products.findIndex((p) => p.id === id);

    if (index === -1) {
      res.status(404).json({ success: false, message: "Product not found" });
      return;
    }

    const [deleted] = DataStore.products.splice(index, 1);
    DataStore.saveProducts();

    res.status(200).json({ success: true, data: { product: deleted } });
  } catch (error) {
    next(error);
  }
}
