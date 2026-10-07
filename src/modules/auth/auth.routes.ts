import { Router } from "express";
import { login, register, refresh, logout, me, changePassword, listSessions, revokeSession, revokeOtherSessions } from "./auth.controller";
import { auth } from "../../middleware/auth";
import { loginLimiter, registrationLimiter, passwordLimiter, sessionLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.post("/login", loginLimiter, login);
router.post("/register", registrationLimiter, register);
router.post("/refresh", sessionLimiter, refresh);
router.post("/logout", sessionLimiter, logout);
router.get("/me", auth, me);
router.patch("/password", auth, passwordLimiter, changePassword);
router.get("/sessions", auth, listSessions);
router.delete("/sessions/others", auth, revokeOtherSessions);
router.delete("/sessions/:id", auth, revokeSession);

export default router;
