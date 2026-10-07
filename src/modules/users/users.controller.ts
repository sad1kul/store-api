import { Response, NextFunction } from "express";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { AuthRequest } from "../../middleware/auth";
import { sanitizeUser } from "../auth/auth.service";
import { db } from "../../config/db";
import { z } from "zod";

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  role: z.enum(["retail", "bulk_buyer", "admin"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  bulkStatus: z.enum(["pending", "approved", "rejected"]).nullable().optional(),
  businessName: z.string().trim().max(255).nullable().optional(),
  businessType: z.string().trim().max(100).nullable().optional(),
}).strict();

function mapUser(row: RowDataPacket) {
  return sanitizeUser({
    id: String(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    bulkStatus: row.bulk_status ?? null,
    businessName: row.business_name ?? undefined,
    businessType: row.business_type ?? undefined,
  });
}

export async function getUsers(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, name, email, role, status, bulk_status, business_name, business_type, created_at FROM users ORDER BY created_at DESC"
    );
    res.status(200).json({ success: true, data: { users: rows.map(mapUser) } });
  } catch (error) {
    next(error);
  }
}

export async function getUserById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, name, email, role, status, bulk_status, business_name, business_type, created_at FROM users WHERE id = ? LIMIT 1",
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    res.status(200).json({ success: true, data: { user: mapUser(rows[0]) } });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "Invalid user update", errors: parsed.error.format() });
      return;
    }

    const fieldMap: Record<string, string> = {
      name: "name",
      role: "role",
      status: "status",
      bulkStatus: "bulk_status",
      businessName: "business_name",
      businessType: "business_type",
    };

    const updates: string[] = [];
    const values: Array<string | string[] | null> = [];


    for (const [key, column] of Object.entries(fieldMap)) {
      const value = parsed.data[key as keyof typeof parsed.data];
      if (value !== undefined) {
        updates.push(`${column} = ?`);
        values.push(value ?? null);
      }
    }

    if (!updates.length) {
      res.status(400).json({ success: false, message: "No valid fields to update" });
      return;
    }

    await connection.beginTransaction();
    const [targetRows] = await connection.execute<RowDataPacket[]>(
      "SELECT role, status FROM users WHERE id = ? FOR UPDATE", [id],
    );
    if (!targetRows.length) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }
    const target = targetRows[0];
    const removesActiveAdmin = target.role === "admin" && target.status === "active" &&
      ((parsed.data.role !== undefined && parsed.data.role !== "admin") || parsed.data.status === "suspended");
    if (removesActiveAdmin) {
      const [adminRows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE role = 'admin' AND status = 'active' FOR UPDATE",
      );
      if (adminRows.length <= 1) {
        await connection.rollback();
        res.status(409).json({ success: false, message: "Cannot remove or suspend the last active administrator" });
        return;
      }
    }

    values.push(id);
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    if (!result.affectedRows) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    await connection.commit();
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, name, email, role, status, bulk_status, business_name, business_type FROM users WHERE id = ? LIMIT 1",
      [id]
    );

    res.status(200).json({ success: true, data: { user: mapUser(rows[0]) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}
