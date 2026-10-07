import mysql from "mysql2/promise";
import { env } from "./env";

export const db = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  decimalNumbers: true,
  ssl: env.DB_SSL === "true" ? {} : undefined,
});

export async function connectDB(): Promise<void> {
  const connection = await db.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}
