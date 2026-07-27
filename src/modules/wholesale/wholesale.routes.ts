import { Router } from "express";
import { getApplications, applyWholesale, reviewApplication } from "./wholesale.controller";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";

const router = Router();

router.get("/applications", auth, requireRole(["admin"]), getApplications);
router.post("/apply", auth, applyWholesale);
router.patch("/applications/:id", auth, requireRole(["admin"]), reviewApplication);

export default router;
