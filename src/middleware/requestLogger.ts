import morgan from "morgan";
import { env } from "../config/env";

morgan.token("request-id", (_req, res) => String(res.getHeader("X-Request-ID") ?? "-"));
morgan.token("request-path", (req) => (req.url ?? "").split("?")[0]);

export const requestLogger = morgan(
  env.NODE_ENV === "development"
    ? ":method :request-path :status :response-time ms :request-id"
    : ":method :request-path :status :res[content-length] :response-time ms :request-id",
);
