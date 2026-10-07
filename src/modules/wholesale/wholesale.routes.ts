import { Router } from "express";
import { getApplications, applyWholesale, reviewApplication } from "./wholesale.controller";
import { auth, optionalAuth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { registrationLimiter } from "../../middleware/rateLimiter";

const router = Router();

router.get("/applications", auth, requireRole(["admin"]), getApplications);
router.post("/apply", registrationLimiter, optionalAuth, applyWholesale);
router.patch("/applications/:id", auth, requireRole(["admin"]), reviewApplication);

export default router;
