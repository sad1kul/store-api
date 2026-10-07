import type { Request, Response, NextFunction } from "express";
import { sessionAccount, verifySessionToken } from "../modules/auth/auth.service";
import { accountResponse, type AccountResponse } from "../modules/auth/auth.types";
import { HttpError } from "../utils/httpError";

export interface AuthenticatedUser extends AccountResponse {
  sessionId: string;
  authVersion: number;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export async function auth(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "");
  if (!match) {
    next(new HttpError(401, "AUTH_REQUIRED", "Authentication required"));
    return;
  }
  try {
    const claims = verifySessionToken(match[1], "access");
    const account = await sessionAccount(claims);
    req.user = { ...accountResponse(account), sessionId: claims.sessionId, authVersion: claims.version };
    next();
  } catch (error) {
    // Infrastructure errors must not turn an authenticated request into a guest request.
    next(error);
  }
}

export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.headers.authorization) {
    next();
    return;
  }
  await auth(req, res, next);
}
