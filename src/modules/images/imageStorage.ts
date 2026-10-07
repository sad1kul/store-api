import fs from "fs/promises";
import path from "path";
import { env } from "../../config/env";

export function imagePath(id: string): string {
  return path.join(env.IMAGE_UPLOAD_DIR, `${id}.webp`);
}

export async function saveImage(id: string, data: Buffer): Promise<void> {
  await fs.mkdir(env.IMAGE_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(imagePath(id), data, { flag: "wx" });
}

export async function removeImage(id: string): Promise<void> {
  try {
    await fs.unlink(imagePath(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
