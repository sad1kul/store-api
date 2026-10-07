import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName = process.env.ADMIN_NAME?.trim();
  if (!adminName || !adminEmail || !adminPassword || adminPassword.length < 14 || Buffer.byteLength(adminPassword, "utf8") > 72) {
    console.error("Reset requires ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 14 characters, at most 72 UTF-8 bytes).");
    process.exitCode = 1;
    return;
  }
  const passwordHash = await bcrypt.hash(adminPassword, 12);

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
    const tablesToWipe = [
      // Revoke sessions before reusing user IDs and account versions.
      "auth_sessions",
      "order_items",
      "orders",
      "bulk_pricing_tiers",
      "product_images",
      "products",
      "wholesale_applications",
      "users",
      "site_content",
    ];

    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    try {
      for (const table of tablesToWipe) {
        await conn.query(`TRUNCATE TABLE \`${table}\``);
      }
    } finally {
      await conn.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    await conn.query(`
      INSERT INTO site_content (id, hero_heading, hero_subtext, promo_banner_text, featured_product_ids)
      VALUES (1, 'Welcome to Smoke Time Store', 'Premium tobacco products delivered to your door.', 'Free delivery on orders over R500!', '[]')
    `);

    await conn.execute(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES (1, ?, ?, ?, 'admin')`,
      [adminName, adminEmail, passwordHash]
    );

    console.log(`Database reset complete: cleared ${tablesToWipe.length} tables, reset site_content, created admin.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(() => {
  console.error("Database reset failed; it may be partially applied. Verify database connectivity and migrations before retrying.");
  process.exitCode = 1;
});
