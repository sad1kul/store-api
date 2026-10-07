import { Request, Response, NextFunction } from "express";
import { HttpError, errorCode } from "../utils/httpError";

const unavailableCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN",
  "PROTOCOL_CONNECTION_LOST", "ER_CON_COUNT_ERROR", "ER_TOO_MANY_USER_CONNECTIONS",
]);

export function publicError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = errorCode(error);
  if (code && unavailableCodes.has(code)) return new HttpError(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable. Please try again.");
  if (code === "ER_DUP_ENTRY") return new HttpError(409, "RESOURCE_CONFLICT", "A record with these details already exists.");
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return new HttpError(409, "CONCURRENT_UPDATE", "The record changed during this request. Please try again.");
  if (code === "LIMIT_FILE_SIZE") return new HttpError(413, "PAYLOAD_TOO_LARGE", "The uploaded file is too large.");
  if (typeof error === "object" && error !== null && "status" in error) {
    if (error.status === 400) return new HttpError(400, "INVALID_REQUEST", "Invalid request.");
    if (error.status === 413) return new HttpError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
    if (error.status === 409) return new HttpError(409, "RESOURCE_CONFLICT", "The request conflicts with the current record.");
  }
  return new HttpError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) { next(err); return; }
  const error = publicError(err);
  if (error.status >= 500) {
    // Do not serialize driver errors: they can contain SQL, credentials and personal data.
    console.error(JSON.stringify({ event: "request_failed", requestId: res.locals.requestId,
      method: req.method, status: error.status, code: error.code }));
  }
  if (error.status === 503) res.setHeader("Retry-After", "5");
  res.status(error.status).json({
    success: false,
    message: error.message,
    code: error.code,
    requestId: res.locals.requestId,
    ...(error.details === undefined ? {} : { errors: error.details }),
  });
}
