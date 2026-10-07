import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../config/db";
import { ContentData } from "../../types";

export const updateContentSchema = z.object({
  heroHeading: z.string().min(1),
  heroSubtext: z.string().min(1),
  promoBannerText: z.string().min(1),
  featuredProductIds: z.array(z.string()),
});

function mapContent(row: RowDataPacket): ContentData {
  let featuredProductIds: string[] = [];
  try {
    featuredProductIds = typeof row.featured_product_ids === "string"
      ? JSON.parse(row.featured_product_ids)
      : (row.featured_product_ids || []);
  } catch {
    featuredProductIds = [];
  }
  return {
    heroHeading: row.hero_heading,
    heroSubtext: row.hero_subtext,
    promoBannerText: row.promo_banner_text,
    featuredProductIds,
  };
}

export async function getContent(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM site_content WHERE id = 1 LIMIT 1"
    );
    if (!rows.length) {
      res.status(200).json({
        success: true,
        data: {
          content: {
            heroHeading: "Welcome to Smoke Time Store",
            heroSubtext: "Premium tobacco products delivered to your door.",
            promoBannerText: "Free delivery on orders over R500!",
            featuredProductIds: [],
          },
        },
      });
      return;
    }
    res.status(200).json({ success: true, data: { content: mapContent(rows[0]) } });
  } catch (error) {
    next(error);
  }
}

export async function updateContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = updateContentSchema.partial().safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid content payload", errors: parse.error.format() });
      return;
    }

    const data = parse.data;
    const updates: string[] = [];
    const values: Array<string | null> = [];

    if (data.heroHeading !== undefined) { updates.push("hero_heading = ?"); values.push(data.heroHeading); }
    if (data.heroSubtext !== undefined) { updates.push("hero_subtext = ?"); values.push(data.heroSubtext); }
    if (data.promoBannerText !== undefined) { updates.push("promo_banner_text = ?"); values.push(data.promoBannerText); }
    if (data.featuredProductIds !== undefined) { updates.push("featured_product_ids = ?"); values.push(JSON.stringify(data.featuredProductIds)); }

    if (!updates.length) {
      res.status(400).json({ success: false, message: "No content fields provided" });
      return;
    }

    // Upsert: ensure row exists first
    await db.execute(
      `INSERT IGNORE INTO site_content (id, hero_heading, hero_subtext, promo_banner_text, featured_product_ids)
       VALUES (1, 'Welcome to Smoke Time Store', 'Premium tobacco products delivered to your door.', 'Free delivery on orders over R500!', '[]')`
    );

    await db.execute<ResultSetHeader>(
      `UPDATE site_content SET ${updates.join(", ")} WHERE id = 1`,
      values
    );

    const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM site_content WHERE id = 1 LIMIT 1");
    res.status(200).json({ success: true, data: { content: mapContent(rows[0]) } });
  } catch (error) {
    next(error);
  }
}
