import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";

export function requireRole(allowedRoles: Array<"retail" | "bulk_buyer" | "admin">) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    if (!allowedRoles.includes(req.user.role as any)) {
      res.status(403).json({ success: false, message: "Forbidden: insufficient permissions" });
      return;
    }

    next();
  };
}
