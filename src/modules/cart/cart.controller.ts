import { Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { calculateCart } from "./cart.service";

export const validateCartSchema = z.object({
  items: z.array(
    z.object({
      productId: z.string(),
      qty: z.number().int().positive(),
    })
  ),
});

export async function validateCart(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = validateCartSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid cart payload", errors: parse.error.format() });
      return;
    }

    const cart = calculateCart(parse.data.items);
    res.status(200).json({
      success: true,
      data: cart,
    });
  } catch (error) {
    next(error);
  }
}
