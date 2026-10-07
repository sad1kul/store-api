import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env";
import { db } from "../../config/db";
import type { User } from "../../types";
import type { AccountRow } from "./auth.types";
import { HttpError } from "../../utils/httpError";

const passwordSchema = z.string().min(12).refine(
  (password) => Buffer.byteLength(password, "utf8") <= 72,
  "Password must be at most 72 UTF-8 bytes",
);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(1024),
});

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
}).strict();

const claimsSchema = z.object({
  id: z.string().regex(/^\d+$/),
  sessionId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  purpose: z.enum(["access", "refresh"]),
  exp: z.number(),
});

export type SessionClaims = z.infer<typeof claimsSchema>;

export function durationSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error("Invalid token lifetime configuration");
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return Number(match[1]) * multiplier[match[2]];
}

export const refreshLifetime = durationSeconds(env.JWT_REFRESH_EXPIRES_IN);
const accessLifetime = durationSeconds(env.JWT_EXPIRES_IN);
const issuer = "smoke-time-api";
const audience = "smoke-time-web";

export function verifySessionToken(token: string, purpose: SessionClaims["purpose"]): SessionClaims {
  try {
    const decoded = jwt.verify(token, purpose === "access" ? env.JWT_SECRET : env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"], issuer, audience,
    });
    const claims = claimsSchema.parse(decoded);
    if (claims.purpose !== purpose) throw new Error("Incorrect token purpose");
    return claims;
  } catch {
    throw new HttpError(401, "SESSION_INVALID", "Your session has expired. Please sign in again.");
  }
}

export function accessToken(claims: Pick<SessionClaims, "id" | "sessionId" | "version">): string {
  return jwt.sign({ id: claims.id, sessionId: claims.sessionId, version: claims.version, purpose: "access" }, env.JWT_SECRET, {
    algorithm: "HS256", issuer, audience, expiresIn: accessLifetime,
  });
}

export async function createSession(account: AccountRow) {
  const claims = { id: String(account.id), sessionId: randomUUID(), version: account.auth_version };
  await db.execute(
    `INSERT INTO auth_sessions (id, user_id, auth_version, expires_at)
     VALUES (?, ?, ?, TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP))`,
    [claims.sessionId, account.id, account.auth_version, refreshLifetime],
  );
  return {
    accessToken: accessToken(claims),
    refreshToken: jwt.sign({ ...claims, purpose: "refresh" }, env.JWT_REFRESH_SECRET, {
      algorithm: "HS256", issuer, audience, expiresIn: refreshLifetime,
    }),
  };
}

export async function sessionAccount(claims: SessionClaims): Promise<AccountRow> {
  const [rows] = await db.execute<AccountRow[]>(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.bulk_status,
            u.business_name, u.business_type, u.auth_version
     FROM users u JOIN auth_sessions s ON s.user_id = u.id
     WHERE u.id = ? AND s.id = ? AND u.status = 'active'
       AND s.expires_at > CURRENT_TIMESTAMP
       AND u.auth_version = ? AND s.auth_version = u.auth_version LIMIT 1`,
    [claims.id, claims.sessionId, claims.version],
  );
  if (!rows[0]) throw new HttpError(401, "SESSION_INVALID", "Your session has expired. Please sign in again.");
  return rows[0];
}

export function sanitizeUser(user: User): Omit<User, "password"> {
  return {
    id: user.id, name: user.name, email: user.email, role: user.role,
    status: user.status, bulkStatus: user.bulkStatus,
    businessName: user.businessName, businessType: user.businessType,
  };
}
