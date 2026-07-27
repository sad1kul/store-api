import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error("Unhandled Error:", err);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    ...(env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
}
