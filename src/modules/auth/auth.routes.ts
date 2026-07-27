import { Router } from "express";
import { login, register, refresh, logout, me } from "./auth.controller";
import { auth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.use(authLimiter);

router.post("/login", login);
router.post("/register", register);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.get("/me", auth, me);

export default router;
