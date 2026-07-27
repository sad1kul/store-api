import cors from "cors";
import { env } from "./env";

const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o: string) => o.trim());

export const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      // Allow requests with no origin (like mobile apps or curl requests)
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1 || env.NODE_ENV === "development") {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

export const corsMiddleware = cors(corsOptions);
