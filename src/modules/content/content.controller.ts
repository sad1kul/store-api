import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { DataStore } from "../../data/dataStore";

export const updateContentSchema = z.object({
  heroHeading: z.string().min(1),
  heroSubtext: z.string().min(1),
  promoBannerText: z.string().min(1),
  featuredProductIds: z.array(z.string()),
});

export async function getContent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ success: true, data: { content: DataStore.content } });
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

    DataStore.content = {
      ...DataStore.content,
      ...parse.data,
    };
    DataStore.saveContent();

    res.status(200).json({ success: true, data: { content: DataStore.content } });
  } catch (error) {
    next(error);
  }
}
