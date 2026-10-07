import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const seedsDir = path.join(__dirname, "../data/seeds");

function readSeed<T>(filename: string): T {
  const filePath = path.join(seedsDir, filename);
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function main() {
  const seedPassword = process.env.SEED_PASSWORD;
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    console.error("Seeding is restricted to NODE_ENV=development or test. Use a disposable database.");
    process.exitCode = 1;
    return;
  }
  if (!seedPassword || seedPassword.length < 14 || Buffer.byteLength(seedPassword, "utf8") > 72) {
    console.error("SEED_PASSWORD is required (at least 14 characters, at most 72 UTF-8 bytes).");
    process.exitCode = 1;
    return;
  }
  const defaultPasswordHash = await bcrypt.hash(seedPassword, 12);
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "",
    ssl: process.env.DB_SSL === "true" ? {} : undefined,
  });

  const conn = await pool.getConnection();
  try {
    const seedUsers = [
      {
        name: "Thabo Nkosi",
        email: "thabo@example.co.za",
        role: "retail",
        status: "active",
        bulk_status: null,
        business_name: null,
        business_type: null,
      },
      {
        name: "Sarah van der Berg",
        email: "sarah@example.co.za",
        role: "retail",
        status: "active",
        bulk_status: null,
        business_name: null,
        business_type: null,
      },
      {
        name: "Sipho Dlamini",
        email: "sipho@smokeworld.co.za",
        role: "bulk_buyer",
        status: "active",
        bulk_status: "approved",
        business_name: "Smoke World Distributors",
        business_type: "Wholesaler",
      },
      {
        name: "Fatima Hassan",
        email: "fatima@cornerstore.co.za",
        role: "bulk_buyer",
        status: "active",
        bulk_status: "pending",
        business_name: "Corner Store Supplies",
        business_type: "Wholesaler",
      },
    ];

    for (const u of seedUsers) {
      const [existing] = await conn.execute<any[]>(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [u.email]
      );
      if (existing.length === 0) {
        await conn.execute(
          `INSERT INTO users (name, email, password_hash, role, status, bulk_status, business_name, business_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [u.name, u.email, defaultPasswordHash, u.role, u.status, u.bulk_status, u.business_name, u.business_type]
        );
      }
    }

    const [adminRows] = await conn.execute<any[]>(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    const adminId = adminRows[0]?.id || 1;

    const productsData = readSeed<any[]>("products.json");
    for (const p of productsData) {
      const [existing] = await conn.execute<any[]>(
        "SELECT id FROM products WHERE slug = ? OR sku = ? LIMIT 1",
        [p.slug, p.sku]
      );

      let productId: number;
      if (existing.length === 0) {
        const [insertRes] = await conn.execute<any>(
          `INSERT INTO products (name, slug, sku, category, description, retail_price, stock, minimum_order_quantity, featured, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          [
            p.name,
            p.slug,
            p.sku,
            p.category,
            p.description,
            p.retailPrice,
            p.stock,
            p.moq || 1,
            p.featured ? 1 : 0,
            adminId,
          ]
        );
        productId = insertRes.insertId;
      } else {
        productId = existing[0].id;
      }

      if (p.bulkPricingTiers && p.bulkPricingTiers.length > 0) {
        const [existingTiers] = await conn.execute<any[]>(
          "SELECT id FROM bulk_pricing_tiers WHERE product_id = ?",
          [productId]
        );
        if (existingTiers.length === 0) {
          for (let i = 0; i < p.bulkPricingTiers.length; i++) {
            const tier = p.bulkPricingTiers[i];
            await conn.execute(
              `INSERT INTO bulk_pricing_tiers (product_id, min_qty, max_qty, price, sort_order)
               VALUES (?, ?, ?, ?, ?)`,
              [productId, tier.minQty, tier.maxQty ?? null, tier.price, i]
            );
          }
        }
      }
    }

    const applicationsData = readSeed<any[]>("bulk-applications.json");
    for (const app of applicationsData) {
      const [existing] = await conn.execute<any[]>(
        "SELECT id FROM wholesale_applications WHERE id = ? LIMIT 1",
        [app.id]
      );
      if (existing.length === 0) {
        await conn.execute(
          `INSERT INTO wholesale_applications
           (id, business_name, owner_name, email, phone, business_type, business_registration,
            monthly_order_value, notes, status, applied_date, approved_date, rejected_date, rejection_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            app.id,
            app.businessName,
            app.ownerName,
            app.email,
            app.phone,
            app.businessType,
            app.businessRegistration || null,
            app.monthlyOrderValue || null,
            app.notes || null,
            app.status,
            app.appliedDate,
            app.approvedDate || null,
            app.rejectedDate || null,
            app.rejectionReason || null,
          ]
        );
      }
    }

    const ordersData = readSeed<any[]>("orders.json");
    for (const ord of ordersData) {
      const [existing] = await conn.execute<any[]>(
        "SELECT id FROM orders WHERE id = ? LIMIT 1",
        [ord.id]
      );
      if (existing.length === 0) {
        // Resolve customer_id: match user by email or fallback to admin
        const [userMatch] = await conn.execute<any[]>(
          "SELECT id FROM users WHERE email = ? LIMIT 1",
          [ord.customerEmail]
        );
        const customerId = userMatch[0]?.id || adminId;

        await conn.execute(
          `INSERT INTO orders
           (id, customer_id, customer_name, customer_email, delivery_address, is_bulk_order,
            subtotal, vat, total, bulk_savings, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ord.id,
            customerId,
            ord.customerName,
            ord.customerEmail,
            ord.deliveryAddress || "123 Business Way, Johannesburg",
            ord.isBulkOrder ? 1 : 0,
            ord.subtotal,
            ord.vat,
            ord.total,
            ord.bulkSavings || 0,
            ord.status,
            `${ord.date} 10:00:00`,
          ]
        );

        if (ord.items && ord.items.length > 0) {
          for (const item of ord.items) {
            // Find product by SKU
            const [prodMatch] = await conn.execute<any[]>(
              "SELECT id FROM products WHERE sku = ? LIMIT 1",
              [item.sku]
            );
            const prodId = prodMatch[0]?.id || null;

            await conn.execute(
              `INSERT INTO order_items
               (order_id, product_id, product_name, sku, image_url, retail_price, unit_price, qty, line_total, is_bulk_priced)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                ord.id,
                prodId,
                item.productName,
                item.sku,
                item.image || null,
                item.retailPrice || item.unitPrice,
                item.unitPrice,
                item.qty,
                item.lineTotal,
                item.isBulkPriced ? 1 : 0,
              ]
            );
          }
        }
      }
    }

    console.log("Database seeding complete.");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(() => {
  console.error("Database seeding failed; it may be partially applied. Verify connectivity, schema and seed files before retrying.");
  process.exitCode = 1;
});
