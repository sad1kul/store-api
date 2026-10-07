import { createHmac } from "node:crypto";
import type { ClientRateLimitInfo, Store } from "express-rate-limit";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { db } from "../config/db";
import { env } from "../config/env";
import { publicError } from "./errorHandler";

export class AuthRateLimitStore implements Store {
  readonly localKeys = false;

  constructor(
    readonly prefix: string,
    private readonly windowMs: number,
    private readonly pool: Pool = db,
  ) {}

  private key(client: string): string {
    return `${this.prefix}:${createHmac("sha256", env.JWT_SECRET).update(client).digest("hex")}`;
  }

  async increment(client: string): Promise<ClientRateLimitInfo> {
    const connection = await this.pool.getConnection();
    const key = this.key(client);
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO auth_rate_limits (bucket_key, hits, reset_at)
         VALUES (?, 1, FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) + ?)
         ON DUPLICATE KEY UPDATE
           hits = IF(reset_at <= FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000), 1, hits + 1),
           reset_at = IF(reset_at <= FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
             FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) + ?, reset_at)`,
        [key, this.windowMs, this.windowMs],
      );
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT hits, reset_at FROM auth_rate_limits WHERE bucket_key = ?", [key],
      );
      await connection.commit();
      return { totalHits: Number(rows[0].hits), resetTime: new Date(Number(rows[0].reset_at)) };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw publicError(error);
    } finally {
      connection.release();
    }
  }

  async decrement(client: string): Promise<void> {
    await this.pool.execute(
      "UPDATE auth_rate_limits SET hits = IF(hits > 0, hits - 1, 0) WHERE bucket_key = ?", [this.key(client)],
    ).catch((error: unknown) => { throw publicError(error); });
  }

  async resetKey(client: string): Promise<void> {
    await this.pool.execute("DELETE FROM auth_rate_limits WHERE bucket_key = ?", [this.key(client)])
      .catch((error: unknown) => { throw publicError(error); });
  }
}
