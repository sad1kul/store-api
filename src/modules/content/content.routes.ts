import { Router } from "express";
import { getContent, updateContent } from "./content.controller";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";

const router = Router();

router.get("/", getContent);
router.put("/", auth, requireRole(["admin"]), updateContent);

export default router;
