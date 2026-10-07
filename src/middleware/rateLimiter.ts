import rateLimit from "express-rate-limit";
import { AuthRateLimitStore } from "./authRateLimitStore";

const fifteenMinutes = 15 * 60 * 1000;

export const loginLimiter = rateLimit({
  windowMs: fifteenMinutes,
  store: new AuthRateLimitStore("login", fifteenMinutes),
  max: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode >= 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "RATE_LIMITED", message: "Too many failed sign-in attempts, please try again later." },
});

export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  store: new AuthRateLimitStore("registration", 60 * 60 * 1000),
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many account requests, please try again later." },
});

export const passwordLimiter = rateLimit({
  windowMs: fifteenMinutes,
  max: 10,
  store: new AuthRateLimitStore("password", fifteenMinutes),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "RATE_LIMITED", message: "Too many password change attempts. Please try again later." },
});

export const sessionLimiter = rateLimit({
  windowMs: fifteenMinutes,
  max: 120,
  store: new AuthRateLimitStore("session", fifteenMinutes),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "RATE_LIMITED", message: "Too many session requests. Please try again later." },
});

export const standardLimiter = rateLimit({
  windowMs: fifteenMinutes,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});
