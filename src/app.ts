import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { corsMiddleware } from "./config/cors";
import { requestLogger } from "./middleware/requestLogger";
import { standardLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";
import { env } from "./config/env";
import { requestId } from "./middleware/requestId";

import authRoutes from "./modules/auth/auth.routes";
import productsRoutes from "./modules/products/products.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import cartRoutes from "./modules/cart/cart.routes";
import wholesaleRoutes from "./modules/wholesale/wholesale.routes";
import contentRoutes from "./modules/content/content.routes";
import usersRoutes from "./modules/users/users.routes";
import imagesRoutes from "./modules/images/images.routes";

const app = express();

// Set the hop count only after verifying the deployed proxy chain and ingress rules.
app.set("trust proxy", env.TRUST_PROXY);

app.use(requestId);
app.use(requestLogger);
app.use(helmet());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(standardLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wholesale", wholesaleRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/images", imagesRoutes);

app.use(errorHandler);

export default app;
