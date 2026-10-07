import { Router } from "express";
import { validateCart } from "./cart.controller";
import { optionalAuth } from "../../middleware/auth";

const router = Router();

router.post("/validate", optionalAuth, validateCart);

export default router;
