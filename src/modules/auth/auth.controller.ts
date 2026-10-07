import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { env } from "../../config/env";
import type { AuthRequest } from "../../middleware/auth";
import { db } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { accountResponse, type AccountRow } from "./auth.types";
import { clearRefreshCookie, setRefreshCookie } from "./auth.cookies";
import {
  loginSchema, registerSchema, changePasswordSchema, createSession,
  accessToken, sessionAccount, verifySessionToken,
} from "./auth.service";

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_FAILED", "Please check the submitted fields.", result.error.flatten());
  }
  return result.data;
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = parseBody(loginSchema, req.body);
  const [rows] = await db.execute<AccountRow[]>("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
  const account = rows[0];
  if (!account || account.status !== "active" || !(await bcrypt.compare(password, account.password_hash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  const session = await createSession(account);
  setRefreshCookie(res, session.refreshToken);
  res.json({ success: true, data: { accessToken: session.accessToken, user: accountResponse(account) } });
}

export async function register(req: Request, res: Response): Promise<void> {
  if (env.ALLOW_PUBLIC_REGISTRATION !== "true") {
    throw new HttpError(403, "REGISTRATION_CLOSED", "Public registration is currently closed");
  }
  const { name, email, password } = parseBody(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await db.execute<ResultSetHeader>(
    "INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, 'retail', 'active')",
    [name, email, passwordHash],
  );
  const [rows] = await db.execute<AccountRow[]>("SELECT * FROM users WHERE id = ?", [result.insertId]);
  const session = await createSession(rows[0]);
  setRefreshCookie(res, session.refreshToken);
  res.status(201).json({ success: true, data: { accessToken: session.accessToken, user: accountResponse(rows[0]) } });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.refreshToken;
  if (typeof token !== "string") throw new HttpError(401, "SESSION_INVALID", "Please sign in again.");
  const claims = verifySessionToken(token, "refresh");
  const account = await sessionAccount(claims);
  // Refresh never rewrites the cookie, so an older response cannot undo a logout.
  // The server session and refresh token share an absolute expiry.
  res.json({ success: true, data: { accessToken: accessToken(claims), user: accountResponse(account) } });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token: unknown = req.cookies?.refreshToken;
  if (typeof token === "string") {
    let claims;
    try {
      claims = verifySessionToken(token, "refresh");
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) throw error;
    }
    if (claims) {
      await db.execute("DELETE FROM auth_sessions WHERE id = ? AND user_id = ?", [claims.sessionId, claims.id]);
    }
  }
  clearRefreshCookie(res);
  res.json({ success: true, message: "Signed out" });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  res.json({ success: true, data: { user: {
    id: user.id, name: user.name, email: user.email, role: user.role,
    status: user.status, bulkStatus: user.bulkStatus,
    businessName: user.businessName, businessType: user.businessType,
  } } });
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const data = parseBody(changePasswordSchema, req.body);
  const [rows] = await db.execute<AccountRow[]>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
  if (!rows[0] || !(await bcrypt.compare(data.currentPassword, rows[0].password_hash))) {
    throw new HttpError(400, "PASSWORD_INCORRECT", "Current password is incorrect");
  }
  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  // Compare-and-swap prevents concurrent password changes from both succeeding.
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE users SET password_hash = ?, auth_version = auth_version + 1
     WHERE id = ? AND password_hash = ? AND auth_version = ? AND status = 'active'`,
    [passwordHash, user.id, rows[0].password_hash, user.authVersion],
  );
  if (result.affectedRows !== 1) throw new HttpError(409, "ACCOUNT_CHANGED", "Your account changed. Please sign in again.");
  clearRefreshCookie(res);
  res.json({ success: true, message: "Password changed. All sessions have been signed out." });
}

export async function listSessions(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(expires_at) AS expires_at
     FROM auth_sessions WHERE user_id = ? AND auth_version = ? AND expires_at > CURRENT_TIMESTAMP
     ORDER BY created_at DESC LIMIT 100`, [user.id, user.authVersion],
  );
  res.json({ success: true, data: { sessions: rows.map((row) => ({
    id: row.id,
    createdAt: new Date(Number(row.created_at) * 1000).toISOString(),
    expiresAt: new Date(Number(row.expires_at) * 1000).toISOString(),
    current: row.id === user.sessionId,
  })) } });
}

export async function revokeOtherSessions(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  await db.execute("DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?", [user.id, user.sessionId]);
  res.json({ success: true, message: "Other sessions signed out" });
}

export async function revokeSession(req: AuthRequest, res: Response): Promise<void> {
  const user = requireUser(req);
  const id = parseBody(z.string().uuid(), req.params.id);
  await db.execute("DELETE FROM auth_sessions WHERE user_id = ? AND id = ?", [user.id, id]);
  if (id === user.sessionId) clearRefreshCookie(res);
  res.json({ success: true });
}

function requireUser(req: AuthRequest) {
  if (!req.user) throw new HttpError(401, "AUTH_REQUIRED", "Authentication required");
  return req.user;
}
