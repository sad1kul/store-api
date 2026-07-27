import { Router } from "express";
import { validateCart } from "./cart.controller";
import { auth } from "../../middleware/auth";

const router = Router();

router.post("/validate", auth, validateCart);

export default router;
