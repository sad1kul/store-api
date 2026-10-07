import "dotenv/config";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

const ADMIN_NAME = process.env.ADMIN_NAME?.trim();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

async function main() {
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASS || ADMIN_PASS.length < 14 || Buffer.byteLength(ADMIN_PASS, "utf8") > 72) {
    console.error("ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (at least 14 characters, at most 72 UTF-8 bytes) are required.");
    process.exitCode = 1;
    return;
  }
  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || "localhost",
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER     || "",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME     || "",
    ssl:      process.env.DB_SSL === "true" ? {} : undefined,
  });

  const connection = await pool.getConnection();
  try {
    await connection.ping();

    const [existing] = await connection.execute<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [ADMIN_EMAIL]
    );

    if (existing.length > 0) {
      console.log(`Admin user already exists (id=${existing[0].id}). No changes made.`);
      return;
    }

    const passwordHash = await bcrypt.hash(ADMIN_PASS, 12);
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [ADMIN_NAME, ADMIN_EMAIL, passwordHash]
    );

    console.log(`Admin user created (id=${result.insertId}).`);
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch(() => {
  console.error("Admin creation failed. Verify database connectivity and the users schema.");
  process.exitCode = 1;
});
