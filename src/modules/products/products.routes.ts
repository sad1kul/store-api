import { Router } from "express";
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from "./products.controller";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";

const router = Router();

router.get("/", getProducts);
router.get("/:slug", getProductBySlug);
router.post("/", auth, requireRole(["admin"]), createProduct);
router.patch("/:id", auth, requireRole(["admin"]), updateProduct);
router.delete("/:id", auth, requireRole(["admin"]), deleteProduct);

export default router;
