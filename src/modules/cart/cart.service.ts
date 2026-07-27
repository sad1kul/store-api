import { DataStore } from "../../data/dataStore";
import { Product, BulkPricingTier } from "../../types";

export interface CartInputItem {
  productId: string;
  qty: number;
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
}

export interface ValidatedCart {
  items: ValidatedCartItem[];
  subtotal: number;
  vat: number;
  total: number;
  bulkSavings: number;
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

export function calculateCart(inputItems: CartInputItem[]): ValidatedCart {
  const validatedItems: ValidatedCartItem[] = [];
  let subtotal = 0;
  let bulkSavings = 0;

  for (const item of inputItems) {
    const product = DataStore.products.find((p) => p.id === item.productId || p.sku === item.productId);
    if (!product) {
      continue;
    }

    const qty = Math.max(1, item.qty);
    const bulkPrice = getApplicableBulkPrice(product.bulkPricingTiers || [], qty);
    const isBulkPriced = bulkPrice !== null;
    const unitPrice = isBulkPriced ? bulkPrice : product.retailPrice;
    const lineTotal = Number((unitPrice * qty).toFixed(2));

    if (isBulkPriced && unitPrice < product.retailPrice) {
      bulkSavings += (product.retailPrice - unitPrice) * qty;
    }

    subtotal += lineTotal;

    validatedItems.push({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      image: product.images[0] || "",
      retailPrice: product.retailPrice,
      unitPrice,
      qty,
      lineTotal,
      isBulkPriced,
      bulkPricingTiers: product.bulkPricingTiers || [],
    });
  }

  subtotal = Number(subtotal.toFixed(2));
  const vat = Number((subtotal * 0.15).toFixed(2));
  const total = Number((subtotal + vat).toFixed(2));
  bulkSavings = Number(bulkSavings.toFixed(2));

  return {
    items: validatedItems,
    subtotal,
    vat,
    total,
    bulkSavings,
  };
}
