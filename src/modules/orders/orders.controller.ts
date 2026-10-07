import { randomBytes } from "crypto";
import { Response, NextFunction } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { AuthRequest } from "../../middleware/auth";
import { calculateCartFromDB } from "../cart/cart.service";
import { db } from "../../config/db";
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

function generateOrderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

async function mapOrderFromDB(row: RowDataPacket, items: RowDataPacket[]): Promise<Order> {
  return {
    id: row.id,
    date: String(row.created_at).split("T")[0],
    customerId: String(row.customer_id),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    deliveryAddress: row.delivery_address,
    isBulkOrder: Boolean(row.is_bulk_order),
    subtotal: Number(row.subtotal),
    vat: Number(row.vat),
    total: Number(row.total),
    bulkSavings: Number(row.bulk_savings),
    status: row.status,
    estimatedDelivery: row.estimated_delivery ?? undefined,
    adminNotes: row.admin_notes ?? undefined,
    items: items.map((i) => ({
      productId: i.product_id ? String(i.product_id) : undefined,
      productName: i.product_name,
      name: i.product_name,
      sku: i.sku,
      image: i.image_url ?? undefined,
      retailPrice: Number(i.retail_price),
      unitPrice: Number(i.unit_price),
      qty: Number(i.qty),
      lineTotal: Number(i.line_total),
      isBulkPriced: Boolean(i.is_bulk_priced),
    })),
  };
}

export async function getOrders(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    let orderRows: RowDataPacket[];
    if (req.user.role === "admin") {
      [orderRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM orders ORDER BY created_at DESC"
      );
    } else {
      [orderRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC",
        [req.user.id]
      );
    }

    const orderIds = orderRows.map((r) => r.id);
    const itemsByOrderId = new Map<string, RowDataPacket[]>();

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => "?").join(",");
      const [itemRows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders})`,
        orderIds
      );
      for (const item of itemRows) {
        const list = itemsByOrderId.get(item.order_id) || [];
        list.push(item);
        itemsByOrderId.set(item.order_id, list);
      }
    }

    const orders: Order[] = await Promise.all(
      orderRows.map((row) => mapOrderFromDB(row, itemsByOrderId.get(row.id) || []))
    );

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
    const [orderRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM orders WHERE id = ? LIMIT 1",
      [id]
    );

    if (!orderRows.length) {
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    const order = orderRows[0];
    if (req.user.role !== "admin" && String(order.customer_id) !== req.user.id && order.customer_email !== req.user.email) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    const [items] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM order_items WHERE order_id = ?",
      [id]
    );

    res.status(200).json({ success: true, data: { order: await mapOrderFromDB(order, items) } });
  } catch (error) {
    next(error);
  }
}

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
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

    const { items: inputItems, total: clientTotal, deliveryAddress, address, city, province, postalCode } = parse.data;

    await connection.beginTransaction();

    const identifiers = inputItems.map((item) => item.productId);
    const placeholders = identifiers.map(() => "?").join(",");
    const [lockedProducts] = await connection.execute<RowDataPacket[]>(
      `SELECT id, sku, stock FROM products
       WHERE (id IN (${placeholders}) OR sku IN (${placeholders})) AND status = 'active'
       FOR UPDATE`,
      [...identifiers, ...identifiers],
    );

    // Calculate only after acquiring stock locks, using the same transaction and current user eligibility.
    const calculatedCart = await calculateCartFromDB(inputItems, req.user, connection);

    if (calculatedCart.items.length !== inputItems.length) {
      await connection.rollback();
      res.status(409).json({ success: false, message: "One or more products are unavailable" });
      return;
    }

    const requestedByProduct = new Map<string, number>();
    for (const item of calculatedCart.items) {
      requestedByProduct.set(item.productId, (requestedByProduct.get(item.productId) || 0) + item.qty);
    }
    for (const [productId, requestedQty] of requestedByProduct) {
      const product = lockedProducts.find((row) => String(row.id) === productId);
      if (!product || Number(product.stock) < requestedQty) {
        await connection.rollback();
        res.status(409).json({ success: false, message: `Insufficient stock for product ${productId}` });
        return;
      }
    }

    // Check for price tampering
    if (clientTotal !== undefined && Math.abs(clientTotal - calculatedCart.total) > 0.05) {
      res.status(409).json({
        success: false,
        message: `Total price mismatch. Client: ${clientTotal}, Server: ${calculatedCart.total}`,
      });
      await connection.rollback();
      return;
    }

    const formattedAddress = deliveryAddress ||
      [address, city, province, postalCode].filter(Boolean).join(", ") || "N/A";

    const estimatedDelivery = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const isBulkOrder = calculatedCart.items.some((i) => i.isBulkPriced) ? 1 : 0;

    const orderId = generateOrderId();

    await connection.execute(
      `INSERT INTO orders
       (id, customer_id, customer_name, customer_email, delivery_address, is_bulk_order,
        subtotal, vat, total, bulk_savings, status, estimated_delivery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        orderId,
        Number(req.user.id),
        req.user.name,
        req.user.email,
        formattedAddress,
        isBulkOrder,
        calculatedCart.subtotal,
        calculatedCart.vat,
        calculatedCart.total,
        calculatedCart.bulkSavings,
        estimatedDelivery,
      ]
    );

    if (calculatedCart.items.length > 0) {
      const placeholders: string[] = [];
      const itemParams: any[] = [];
      for (const item of calculatedCart.items) {
        placeholders.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        itemParams.push(
          orderId,
          Number(item.productId) || null,
          item.name,
          item.sku,
          item.image || null,
          item.retailPrice,
          item.unitPrice,
          item.qty,
          item.lineTotal,
          item.isBulkPriced ? 1 : 0
        );
      }
      await connection.execute(
        `INSERT INTO order_items
         (order_id, product_id, product_name, sku, image_url, retail_price, unit_price, qty, line_total, is_bulk_priced)
         VALUES ${placeholders.join(", ")}`,
        itemParams
      );

      for (const item of calculatedCart.items) {
        const [stockResult] = await connection.execute<ResultSetHeader>(
          "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
          [item.qty, Number(item.productId), item.qty]
        );
        if (stockResult.affectedRows !== 1) {
          throw new Error(`Stock changed for product ${item.productId}`);
        }
      }
    }

    await connection.commit();

    const [orderRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM orders WHERE id = ? LIMIT 1", [orderId]
    );
    const [itemRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM order_items WHERE order_id = ?", [orderId]
    );

    res.status(201).json({ success: true, data: { order: await mapOrderFromDB(orderRows[0], itemRows) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

export async function updateOrderStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses: OrderStatus[] = ["pending", "processing", "shipped", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ success: false, message: "Invalid order status" });
      return;
    }

    await connection.beginTransaction();
    const [existingRows] = await connection.execute<RowDataPacket[]>(
      "SELECT status FROM orders WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!existingRows.length) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    const previousStatus = existingRows[0].status as OrderStatus;
    if (previousStatus === "cancelled" && status !== "cancelled") {
      await connection.rollback();
      res.status(409).json({ success: false, message: "Cancelled orders cannot be reopened automatically" });
      return;
    }

    const [result] = await connection.execute<ResultSetHeader>(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id]
    );

    if (!result.affectedRows) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "Order not found" });
      return;
    }

    if (status === "cancelled" && previousStatus !== "cancelled") {
      const [items] = await connection.execute<RowDataPacket[]>(
        "SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL",
        [id],
      );
      for (const item of items) {
        await connection.execute("UPDATE products SET stock = stock + ? WHERE id = ?", [item.qty, item.product_id]);
      }
    }

    await connection.commit();

    const [orderRows] = await db.execute<RowDataPacket[]>("SELECT * FROM orders WHERE id = ? LIMIT 1", [id]);
    const [itemRows] = await db.execute<RowDataPacket[]>("SELECT * FROM order_items WHERE order_id = ?", [id]);

    res.status(200).json({ success: true, data: { order: await mapOrderFromDB(orderRows[0], itemRows) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}
