import { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../config/db";
import { BulkPricingTier } from "../../types";

export interface CartInputItem {
  productId: string;
  qty: number;
}

export interface PricingContext {
  role: "guest" | "retail" | "bulk_buyer" | "admin";
  bulkStatus?: "approved" | "pending" | "rejected" | null;
}

export interface ValidatedCartItem {
  productId: string;
  name: string;
  slug: string;
  sku: string;
  image: string;
  retailPrice: number;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  isBulkPriced: boolean;
  bulkPricingTiers: BulkPricingTier[];
  availableStock: number;
}

export interface StockIssue {
  productId: string;
  name: string;
  requestedQty: number;
  availableStock: number;
}

export interface ValidatedCart {
  items: ValidatedCartItem[];
  subtotal: number;
  vat: number;
  total: number;
  bulkSavings: number;
  stockIssues: StockIssue[];
}

export function getApplicableBulkPrice(tiers: BulkPricingTier[], qty: number): number | null {
  for (const tier of tiers) {
    const withinMax = tier.maxQty === null || qty <= tier.maxQty;
    if (qty >= tier.minQty && withinMax) {
      return tier.price;
    }
  }
  return null;
}

export async function calculateCartFromDB(
  inputItems: CartInputItem[],
  customer: PricingContext,
  executor: Pool | PoolConnection = db,
): Promise<ValidatedCart> {
  if (!inputItems.length) {
    return { items: [], subtotal: 0, vat: 0, total: 0, bulkSavings: 0, stockIssues: [] };
  }

  const ids = inputItems.map((i) => i.productId);
  const placeholders = ids.map(() => "?").join(",");

  const [productRows] = await executor.execute<RowDataPacket[]>(
    `SELECT p.id, p.name, p.slug, p.sku, p.retail_price, p.stock, p.status,
            GROUP_CONCAT(pi.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS first_image
     FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id
     WHERE (p.id IN (${placeholders}) OR p.sku IN (${placeholders})) AND p.status = 'active'
     GROUP BY p.id`,
    [...ids, ...ids]
  );

  const productIds = productRows.map((r) => r.id);
  const tiersByProductId: Record<number, BulkPricingTier[]> = {};

  if (productIds.length) {
    const tierPlaceholders = productIds.map(() => "?").join(",");
    const [tierRows] = await executor.execute<RowDataPacket[]>(
      `SELECT product_id, min_qty, max_qty, price FROM bulk_pricing_tiers WHERE product_id IN (${tierPlaceholders}) ORDER BY product_id, sort_order`,
      productIds
    );
    for (const tier of tierRows) {
      if (!tiersByProductId[tier.product_id]) tiersByProductId[tier.product_id] = [];
      tiersByProductId[tier.product_id].push({ minQty: tier.min_qty, maxQty: tier.max_qty, price: Number(tier.price) });
    }
  }

  const validatedItems: ValidatedCartItem[] = [];
  let subtotal = 0;
  let bulkSavings = 0;
  const stockIssues: StockIssue[] = [];

  for (const inputItem of inputItems) {
    const product = productRows.find(
      (p) => String(p.id) === inputItem.productId || p.sku === inputItem.productId
    );
    if (!product) {
      stockIssues.push({
        productId: inputItem.productId,
        name: "Unavailable product",
        requestedQty: inputItem.qty,
        availableStock: 0,
      });
      continue;
    }

    const tiers: BulkPricingTier[] = tiersByProductId[product.id] || [];
    const qty = Math.max(1, inputItem.qty);
    const retailPrice = Number(product.retail_price);
    const mayUseBulkPricing = customer.role === "bulk_buyer" && customer.bulkStatus === "approved";
    const bulkPrice = mayUseBulkPricing ? getApplicableBulkPrice(tiers, qty) : null;
    const isBulkPriced = bulkPrice !== null;
    const unitPrice = isBulkPriced ? bulkPrice! : retailPrice;
    const lineTotal = Number((unitPrice * qty).toFixed(2));
    const availableStock = Number(product.stock);

    if (qty > availableStock) {
      stockIssues.push({
        productId: String(product.id),
        name: product.name,
        requestedQty: qty,
        availableStock,
      });
    }

    if (isBulkPriced && unitPrice < retailPrice) {
      bulkSavings += (retailPrice - unitPrice) * qty;
    }

    subtotal += lineTotal;

    const firstImage = product.first_image ? `/api/images/${product.first_image}` : "";

    validatedItems.push({
      productId: String(product.id),
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      image: firstImage,
      retailPrice,
      unitPrice,
      qty,
      lineTotal,
      isBulkPriced,
      bulkPricingTiers: tiers,
      availableStock,
    });
  }

  subtotal = Number(subtotal.toFixed(2));
  const vat = Number((subtotal * 0.15).toFixed(2));
  const total = Number((subtotal + vat).toFixed(2));
  bulkSavings = Number(bulkSavings.toFixed(2));

  return { items: validatedItems, subtotal, vat, total, bulkSavings, stockIssues };
}
