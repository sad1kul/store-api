import { Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import { DataStore } from "../../data/dataStore";
import { sanitizeUser } from "../auth/auth.service";

export async function getUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sanitizedUsers = DataStore.users.map((u) => sanitizeUser(u));
    res.status(200).json({ success: true, data: { users: sanitizedUsers } });
  } catch (error) {
    next(error);
  }
}

export async function getUserById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const user = DataStore.users.find((u) => u.id === id);

    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.status(200).json({ success: true, data: { user: sanitizeUser(user) } });
  } catch (error) {
    next(error);
  }
}

export async function updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const userIndex = DataStore.users.findIndex((u) => u.id === id);

    if (userIndex === -1) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const { name, role, status, bulkStatus, businessName, businessType } = req.body;

    DataStore.users[userIndex] = {
      ...DataStore.users[userIndex],
      ...(name !== undefined && { name }),
      ...(role !== undefined && { role }),
      ...(status !== undefined && { status }),
      ...(bulkStatus !== undefined && { bulkStatus }),
      ...(businessName !== undefined && { businessName }),
      ...(businessType !== undefined && { businessType }),
    };

    DataStore.saveUsers();

    res.status(200).json({ success: true, data: { user: sanitizeUser(DataStore.users[userIndex]) } });
  } catch (error) {
    next(error);
  }
}
