import { RowDataPacket } from "mysql2";
import { db } from "../config/db";

const requiredTables = ["users", "products", "product_images"];

async function check(): Promise<void> {
  const [databaseRows] = await db.query<RowDataPacket[]>("SELECT DATABASE() AS database_name");
  const [tableRows] = await db.query<RowDataPacket[]>(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?, ?)`,
    requiredTables
  );
  const found = new Set(tableRows.map((row) => String(row.TABLE_NAME)));
  const missing = requiredTables.filter((table) => !found.has(table));
  if (missing.length) throw new Error(`Missing required tables: ${missing.join(", ")}`);

  const [foreignKeyRows] = await db.query<RowDataPacket[]>(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('products', 'product_images')`
  );
  const counts = await Promise.all(requiredTables.map(async (table) => {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS row_count FROM \`${table}\``);
    return [table, Number(rows[0].row_count)] as const;
  }));

  console.log(JSON.stringify({
    database: databaseRows[0].database_name,
    tables: counts.reduce<Record<string, number>>((result, [table, count]) => {
      result[table] = count;
      return result;
    }, {}),
    foreignKeys: foreignKeyRows.map((row) => row.CONSTRAINT_NAME),
    mode: "read-only",
  }));
}

check()
  .catch(() => { console.error("Database check failed. Verify connectivity and schema migrations."); process.exitCode = 1; })
  .finally(() => db.end());
