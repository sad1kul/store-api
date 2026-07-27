import { Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { AuthRequest } from "../../middleware/auth";
import { DataStore } from "../../data/dataStore";
import { WholesaleApplication, ApplicationStatus } from "../../types";

export const applyWholesaleSchema = z.object({
  businessName: z.string().min(1),
  ownerName: z.string().min(1),
  email: z.string().email(),
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

export async function getApplications(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ success: true, data: { applications: DataStore.wholesaleApplications } });
  } catch (error) {
    next(error);
  }
}

export async function applyWholesale(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parse = applyWholesaleSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, message: "Invalid application data", errors: parse.error.format() });
      return;
    }

    const newApp: WholesaleApplication = {
      id: `app-${uuidv4().slice(0, 8)}`,
      ...parse.data,
      phone: parse.data.phone || parse.data.cellphone || "",
      monthlyOrderValue: parse.data.monthlyOrderValue || parse.data.estimatedMonthlySpend || "N/A",
      appliedDate: new Date().toISOString().split("T")[0],
      submittedAt: new Date().toISOString(),
      status: "pending",
    };

    DataStore.wholesaleApplications.unshift(newApp);
    DataStore.saveWholesaleApplications();

    // Update user's bulkStatus if user logged in
    if (req.user) {
      const user = DataStore.users.find((u) => u.id === req.user?.id || u.email === req.user?.email);
      if (user) {
        user.bulkStatus = "pending";
        user.businessName = parse.data.businessName;
        user.businessType = parse.data.businessType;
        DataStore.saveUsers();
      }
    }

    res.status(201).json({ success: true, data: { application: newApp } });
  } catch (error) {
    next(error);
  }
}

export async function reviewApplication(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { status, rejectionReason, notes } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ success: false, message: "Invalid status decision" });
      return;
    }

    const app = DataStore.wholesaleApplications.find((a) => a.id === id);
    if (!app) {
      res.status(404).json({ success: false, message: "Application not found" });
      return;
    }

    app.status = status as ApplicationStatus;
    const today = new Date().toISOString().split("T")[0];

    if (status === "approved") {
      app.approvedDate = today;
      // Promote applicant user to bulk_buyer role
      const user = DataStore.users.find((u) => u.email.toLowerCase() === app.email.toLowerCase());
      if (user) {
        user.role = "bulk_buyer";
        user.bulkStatus = "approved";
        user.businessName = app.businessName;
        user.businessType = app.businessType;
        DataStore.saveUsers();
      }
    } else if (status === "rejected") {
      app.rejectedDate = today;
      app.rejectionReason = rejectionReason || "Application rejected";
      const user = DataStore.users.find((u) => u.email.toLowerCase() === app.email.toLowerCase());
      if (user) {
        user.bulkStatus = "rejected";
        DataStore.saveUsers();
      }
    }

    if (notes) {
      app.adminNotes = notes;
    }

    DataStore.saveWholesaleApplications();

    res.status(200).json({ success: true, data: { application: app } });
  } catch (error) {
    next(error);
  }
}
