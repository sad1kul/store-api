import { db } from "../../config/db";

export async function verifyAuthSchema(): Promise<void> {
  await db.query("SELECT auth_version FROM users LIMIT 0");
  await db.query("SELECT id, user_id, auth_version, expires_at FROM auth_sessions LIMIT 0");
  await db.query("SELECT bucket_key, hits, reset_at FROM auth_rate_limits LIMIT 0");
}
