import fs from "fs";
import { NextFunction, Response } from "express";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../config/db";
import { AuthRequest } from "../../middleware/auth";
import { imagePath, removeImage, saveImage } from "./imageStorage";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function uploadImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  let imageId: string | null = null;
  try {
    if (!req.user || req.user.role !== "admin") {
      res.status(403).json({ success: false, message: "Admin access required" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ success: false, message: "Image file is required" });
      return;
    }

    const metadata = await sharp(req.file.buffer).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      res.status(415).json({ success: false, message: "Only JPEG, PNG and WebP images are supported" });
      return;
    }

    const processed = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    imageId = uuidv4();
    await saveImage(imageId, processed.data);

    const productId = req.body.productId ? Number(req.body.productId) : null;
    const altText = req.body.altText ? String(req.body.altText).trim().slice(0, 255) : null;
    const isPrimary = req.body.isPrimary === "true" || req.body.isPrimary === "1";

    await db.execute<ResultSetHeader>(
      `INSERT INTO product_images
       (id, product_id, original_name, mime_type, size_bytes, width, height, uploaded_by, alt_text, is_primary)
       VALUES (?, ?, ?, 'image/webp', ?, ?, ?, ?, ?, ?)`,
      [imageId, productId, req.file.originalname.slice(0, 255), processed.data.length,
       processed.info.width, processed.info.height, Number(req.user.id), altText, isPrimary ? 1 : 0]
    );

    res.status(201).json({
      success: true,
      data: { image: { id: imageId, url: `/api/images/${imageId}` } },
    });
  } catch (error) {
    if (imageId) await removeImage(imageId).catch(() => undefined);
    next(error);
  }
}

export async function getImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!UUID_PATTERN.test(id)) {
      res.status(400).json({ success: false, message: "Invalid image ID" });
      return;
    }
    const [rows] = await db.execute<RowDataPacket[]>("SELECT id FROM product_images WHERE id = ?", [id]);
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: "Image not found" });
      return;
    }

    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    const stream = fs.createReadStream(imagePath(id));
    stream.on("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

export async function deleteImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = String(req.params.id);
    if (!UUID_PATTERN.test(id)) {
      res.status(400).json({ success: false, message: "Invalid image ID" });
      return;
    }
    const [result] = await db.execute<ResultSetHeader>("DELETE FROM product_images WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      res.status(404).json({ success: false, message: "Image not found" });
      return;
    }
    await removeImage(id);
    res.status(200).json({ success: true, message: "Image deleted" });
  } catch (error) {
    next(error);
  }
}
