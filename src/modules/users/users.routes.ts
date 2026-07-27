import { Router } from "express";
import { getUsers, getUserById, updateUser } from "./users.controller";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";

const router = Router();

router.use(auth);
router.use(requireRole(["admin"]));

router.get("/", getUsers);
router.get("/:id", getUserById);
router.patch("/:id", updateUser);

export default router;
