import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";
import { refreshLifetime } from "./auth.service";

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
};

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie("refreshToken", token, { ...cookieOptions, maxAge: refreshLifetime * 1000 });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", cookieOptions);
}
