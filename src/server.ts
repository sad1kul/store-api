import app from "./app";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { verifyAuthSchema } from "./modules/auth/auth.schemaCheck";

async function start(): Promise<void> {
  await connectDB();
  await verifyAuthSchema();
  app.listen(env.PORT, () => {
    console.log(`Smoke Time Store API listening on port ${env.PORT}`);
  });
}

start().catch(() => {
  console.error("Failed to start API. Verify database connectivity and apply the required schema migrations.");
  process.exit(1);
});
