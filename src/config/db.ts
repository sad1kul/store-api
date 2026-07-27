// ─── DATABASE CONFIG — PLACEHOLDER ──────────────────────────────────────────
// The API currently runs on seed JSON files. When you're ready to add a real
// database, replace connectDB with your chosen adapter:
//
//   Option A — PostgreSQL via Prisma
//   Option B — MongoDB via Mongoose
//   Option C — MySQL via Prisma
// ─────────────────────────────────────────────────────────────────────────────

export async function connectDB(): Promise<void> {
  console.warn("[DB] No database configured. API is running in seed/JSON mode.");
}
