import { Router } from "express";
import { getOrders, getOrderById, createOrder, updateOrderStatus } from "./orders.controller";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";

const router = Router();

router.use(auth);

router.get("/", getOrders);
router.get("/:id", getOrderById);
router.post("/", createOrder);
router.patch("/:id/status", requireRole(["admin"]), updateOrderStatus);

export default router;
