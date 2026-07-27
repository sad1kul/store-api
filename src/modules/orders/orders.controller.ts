import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { DataStore } from "../../data/dataStore";
import { calculateCart } from "../cart/cart.service";
import { Order, OrderStatus } from "../../types";

export const createOrderSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      qty: z.number().int().positive(),
    })
  ).min(1),
  deliveryAddress: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  total: z.number().optional(),
});

export async function getOrders(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    let orders = DataStore.orders;
    if (req.user.role !== "admin") {
      orders = orders.filter((o) => o.customerId === req.user?.id || o.customerEmail === req.user?.email);
    }

    res.status(200).json({ success: true, data: { orders } });
  } catch (error) {
    next(error);
  }
}

export async function getOrderById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const { id } = req.params;
    const order = DataStore.orders.find((o) => o.id === id);

    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    if (req.user.role !== "admin" && order.customerId !== req.user.id && order.customerEmail !== req.user.email) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
}

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const parse = createOrderSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid order payload", errors: parse.error.format() });
      return;
    }

    const { items, total: clientTotal, deliveryAddress, address, city, province, postalCode } = parse.data;

    // Server-side calculation of cart totals & pricing
    const calculatedCart = calculateCart(items);

    if (calculatedCart.items.length === 0) {
      res.status(400).json({ success: false, message: "No valid products in order" });
      return;
    }

    // Check for price tampering if client total was provided
    if (clientTotal !== undefined && Math.abs(clientTotal - calculatedCart.total) > 0.05) {
      res.status(409).json({
        success: false,
        message: `Total price mismatch (tampered total detected). Client provided ${clientTotal}, calculated server total is ${calculatedCart.total}`,
      });
      return;
    }

    // Deduct stock for each product
    for (const item of calculatedCart.items) {
      const product = DataStore.products.find((p) => p.id === item.productId);
      if (product) {
        product.stock = Math.max(0, product.stock - item.qty);
      }
    }
    DataStore.saveProducts();

    const formattedAddress = deliveryAddress || [address, city, province, postalCode].filter(Boolean).join(", ") || "N/A";

    const newOrder: Order = {
      id: `ORD-${Math.floor(100000 + Math.random() * 900000)}`,
      date: new Date().toISOString().split("T")[0],
      customerId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      deliveryAddress: formattedAddress,
      isBulkOrder: calculatedCart.items.some((i) => i.isBulkPriced),
      items: calculatedCart.items.map((i) => ({
        productId: i.productId,
        productName: i.name,
        name: i.name,
        slug: i.slug,
        sku: i.sku,
        image: i.image,
        retailPrice: i.retailPrice,
        unitPrice: i.unitPrice,
        qty: i.qty,
        lineTotal: i.lineTotal,
        isBulkPriced: i.isBulkPriced,
        bulkPricingTiers: i.bulkPricingTiers,
      })),
      subtotal: calculatedCart.subtotal,
      vat: calculatedCart.vat,
      total: calculatedCart.total,
      bulkSavings: calculatedCart.bulkSavings,
      status: "pending",
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    };

    DataStore.orders.unshift(newOrder);
    DataStore.saveOrders();

    res.status(201).json({ success: true, data: { order: newOrder } });
  } catch (error) {
    next(error);
  }
}

export async function updateOrderStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, message: "Invalid order status" });
      return;
    }

    const order = DataStore.orders.find((o) => o.id === id);
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    order.status = status;
    DataStore.saveOrders();

    res.status(200).json({ success: true, data: { order } });
  } catch (error) {
    next(error);
  }
}
