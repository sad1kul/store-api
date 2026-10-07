import "dotenv/config";
import type { ResultSetHeader } from "mysql2";
import { db } from "../config/db";

async function prune(): Promise<void> {
  const [sessions] = await db.execute<ResultSetHeader>(
    "DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP LIMIT 1000",
  );
  const [limits] = await db.execute<ResultSetHeader>(
    "DELETE FROM auth_rate_limits WHERE reset_at < FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP) * 1000) - 86400000 LIMIT 1000",
  );
  console.log(JSON.stringify({ expiredSessionsRemoved: sessions.affectedRows, oldCountersRemoved: limits.affectedRows }));
}

prune().catch(() => {
  console.error("Security data cleanup failed. Verify database connectivity and migrations.");
  process.exitCode = 1;
}).finally(() => db.end());
