import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/db";
import { corsMiddleware } from "./config/cors";
import { requestLogger } from "./middleware/requestLogger";
import { standardLimiter } from "./middleware/rateLimiter";
import { errorHandler } from "./middleware/errorHandler";

import authRoutes from "./modules/auth/auth.routes";
import productsRoutes from "./modules/products/products.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import cartRoutes from "./modules/cart/cart.routes";
import wholesaleRoutes from "./modules/wholesale/wholesale.routes";
import contentRoutes from "./modules/content/content.routes";
import usersRoutes from "./modules/users/users.routes";

const app = express();

// Boot database placeholder
connectDB();

// Middleware chain in exact requested order
app.use(requestLogger);
app.use(helmet());
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(standardLimiter);

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routers under /api
app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/wholesale", wholesaleRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/users", usersRoutes);

// Error handler last
app.use(errorHandler);

export default app;
