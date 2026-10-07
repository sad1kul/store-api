import { Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { AuthRequest } from "../../middleware/auth";
import { db } from "../../config/db";
import { WholesaleApplication, ApplicationStatus } from "../../types";

export const applyWholesaleSchema = z.object({
  businessName: z.string().min(1),
  ownerName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  cellphone: z.string().optional(),
  phone: z.string().optional(),
  businessType: z.string().optional(),
  businessRegistration: z.string().optional(),
  shopAddress: z.string().optional(),
  shopCity: z.string().optional(),
  shopProvince: z.string().optional(),
  shopPostalCode: z.string().optional(),
  taxNumber: z.string().optional(),
  estimatedMonthlySpend: z.string().optional(),
  monthlyOrderValue: z.string().optional(),
  notes: z.string().optional(),
  shopPhotos: z.array(z.string()).optional(),
});

function formatDate(val: any): string | undefined {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  const str = String(val);
  if (str.includes("T")) return str.split("T")[0];
  return str.length >= 10 ? str.slice(0, 10) : str;
}

function mapApplication(row: RowDataPacket): WholesaleApplication {
  return {
    id: row.id,
    businessName: row.business_name,
    ownerName: row.owner_name,
    email: row.email,
    phone: row.phone ?? "",
    businessType: row.business_type ?? undefined,
    businessRegistration: row.business_registration ?? undefined,
    shopAddress: row.shop_address ?? undefined,
    shopCity: row.shop_city ?? undefined,
    shopProvince: row.shop_province ?? undefined,
    shopPostalCode: row.shop_postal_code ?? undefined,
    taxNumber: row.tax_number ?? undefined,
    monthlyOrderValue: row.monthly_order_value ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status as ApplicationStatus,
    appliedDate: formatDate(row.applied_date) || formatDate(row.submitted_at) || "",
    submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : undefined,
    approvedDate: formatDate(row.approved_date),
    rejectedDate: formatDate(row.rejected_date),
    rejectionReason: row.rejection_reason ?? undefined,
    adminNotes: row.admin_notes ?? undefined,
  };
}

export async function getApplications(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wholesale_applications ORDER BY submitted_at DESC"
    );
    res.status(200).json({ success: true, data: { applications: rows.map(mapApplication) } });
  } catch (error) {
    next(error);
  }
}

export async function applyWholesale(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  try {
    const parse = applyWholesaleSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid application data", errors: parse.error.format() });
      return;
    }

    const data = parse.data;
    const appId = `app-${uuidv4().slice(0, 8)}`;
    const today = new Date().toISOString().split("T")[0];
    const phone = data.phone || data.cellphone || "";
    const monthlyOrderValue = data.monthlyOrderValue || data.estimatedMonthlySpend || null;
    const normalizedEmail = data.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(data.password, 12);

    await connection.beginTransaction();

    const [duplicateApplications] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM wholesale_applications WHERE email = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
      [normalizedEmail]
    );
    if (duplicateApplications.length > 0) {
      await connection.rollback();
      res.status(409).json({ success: false, message: "A wholesale application for this email is already pending review." });
      return;
    }

    const [existingUsers] = await connection.execute<RowDataPacket[]>(
      "SELECT id, role, status, password_hash FROM users WHERE email = ? LIMIT 1 FOR UPDATE",
      [normalizedEmail]
    );

    let userId: number;
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      if (existingUser.role === "admin" || existingUser.role === "bulk_buyer") {
        await connection.rollback();
        res.status(409).json({ success: false, message: "This account cannot submit another wholesale application." });
        return;
      }
      const ownsAccount = req.user?.id === String(existingUser.id)
        || await bcrypt.compare(data.password, existingUser.password_hash);
      if (!ownsAccount) {
        await connection.rollback();
        res.status(409).json({ success: false, message: "An account already exists for this email. Sign in before applying." });
        return;
      }
      userId = Number(existingUser.id);
      await connection.execute(
        `UPDATE users
         SET bulk_status = 'pending', business_name = ?, business_type = ?
         WHERE id = ?`,
        [data.businessName, data.businessType ?? null, userId]
      );
    } else {
      const [insertedUser] = await connection.execute<ResultSetHeader>(
        `INSERT INTO users (name, email, password_hash, role, status, bulk_status, business_name, business_type)
         VALUES (?, ?, ?, 'retail', 'active', 'pending', ?, ?)`,
        [data.ownerName, normalizedEmail, passwordHash, data.businessName, data.businessType ?? null]
      );
      userId = insertedUser.insertId;
    }

    await connection.execute(
      `INSERT INTO wholesale_applications
       (id, user_id, business_name, owner_name, email, phone, business_type, business_registration,
        shop_address, shop_city, shop_province, shop_postal_code, tax_number, monthly_order_value,
        notes, status, applied_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        appId,
        userId,
        data.businessName,
        data.ownerName,
        normalizedEmail,
        phone,
        data.businessType ?? null,
        data.businessRegistration ?? null,
        data.shopAddress ?? null,
        data.shopCity ?? null,
        data.shopProvince ?? null,
        data.shopPostalCode ?? null,
        data.taxNumber ?? null,
        monthlyOrderValue,
        data.notes ?? null,
        today,
      ]
    );
    await connection.commit();

    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM wholesale_applications WHERE id = ? LIMIT 1",
      [appId]
    );

    res.status(201).json({ success: true, data: { application: mapApplication(rows[0]) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

export async function reviewApplication(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const { status, rejectionReason, notes } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ success: false, message: "Invalid status decision" });
      return;
    }

    await connection.beginTransaction();

    const [appRows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM wholesale_applications WHERE id = ? LIMIT 1 FOR UPDATE",
      [id]
    );
    if (!appRows.length) {
      await connection.rollback();
      res.status(404).json({ success: false, message: "Application not found" });
      return;
    }

    const app = appRows[0];
    if (app.status !== "pending") {
      await connection.rollback();
      res.status(409).json({ success: false, message: "This application has already been reviewed." });
      return;
    }
    const today = new Date().toISOString().split("T")[0];

    let targetUserId = app.user_id;
    if (!targetUserId) {
      const [userMatch] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
        [app.email]
      );
      if (userMatch.length > 0) {
        targetUserId = userMatch[0].id;
        await connection.execute("UPDATE wholesale_applications SET user_id = ? WHERE id = ?", [targetUserId, id]);
      }
    }

    if (status === "approved") {
      if (!targetUserId) {
        throw Object.assign(new Error("The applicant account is missing. Ask the applicant to submit a new application."), { status: 409 });
      }

      await connection.execute(
        "UPDATE wholesale_applications SET status = 'approved', approved_date = ?, admin_notes = ? WHERE id = ?",
        [today, notes ?? null, id]
      );
      const [updateResult] = await connection.execute<ResultSetHeader>(
        `UPDATE users
         SET role = 'bulk_buyer', status = 'active', bulk_status = 'approved', business_name = ?, business_type = ?
         WHERE id = ?`,
        [app.business_name, app.business_type ?? null, targetUserId]
      );

      if (updateResult.affectedRows === 0) {
        throw Object.assign(new Error("The applicant account is missing. Ask the applicant to submit a new application."), { status: 409 });
      }
    } else {
      await connection.execute(
        "UPDATE wholesale_applications SET status = 'rejected', rejected_date = ?, rejection_reason = ?, admin_notes = ? WHERE id = ?",
        [today, rejectionReason || "Application rejected", notes ?? null, id]
      );
      if (targetUserId) {
        await connection.execute(
          "UPDATE users SET bulk_status = 'rejected' WHERE id = ?",
          [targetUserId]
        );
      }
    }

    await connection.commit();

    const [updatedRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wholesale_applications WHERE id = ? LIMIT 1",
      [id]
    );

    res.status(200).json({ success: true, data: { application: mapApplication(updatedRows[0]) } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}
