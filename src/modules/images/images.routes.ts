import { Router } from "express";
import multer from "multer";
import { auth } from "../../middleware/auth";
import { requireRole } from "../../middleware/requireRole";
import { deleteImage, getImage, uploadImage } from "./images.controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get("/:id", getImage);
router.post("/", auth, requireRole(["admin"]), upload.single("image"), uploadImage);
router.delete("/:id", auth, requireRole(["admin"]), deleteImage);

export default router;
