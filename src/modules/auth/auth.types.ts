import type { RowDataPacket } from "mysql2";
import type { User } from "../../types";

export interface AccountRow extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: User["role"];
  status: string;
  bulk_status: User["bulkStatus"];
  business_name: string | null;
  business_type: string | null;
  auth_version: number;
}

export type AccountResponse = Pick<User,
  "id" | "name" | "email" | "role" | "status" | "bulkStatus" | "businessName" | "businessType"
>;

export function accountResponse(row: AccountRow): AccountResponse {
  return {
    id: String(row.id), name: row.name, email: row.email, role: row.role,
    status: row.status, bulkStatus: row.bulk_status ?? null,
    businessName: row.business_name ?? undefined,
    businessType: row.business_type ?? undefined,
  };
}
