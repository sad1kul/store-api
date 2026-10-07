import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET must be set"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET must be set"),
  JWT_EXPIRES_IN: z.string().regex(/^[1-9]\d{0,5}[smhd]$/).default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^[1-9]\d{0,5}[smhd]$/).default("7d"),
  ALLOWED_ORIGINS: z.string().min(1, "ALLOWED_ORIGINS must be set"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().min(1),
  DB_SSL: z.enum(["true", "false"]).default("false"),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(5).max(100).default(25),
  IMAGE_UPLOAD_DIR: z.string().min(1),
  ALLOW_PUBLIC_REGISTRATION: z.enum(["true", "false"]).default("false"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;

  for (const key of ["JWT_SECRET", "JWT_REFRESH_SECRET"] as const) {
    const secret = value[key];
    if (secret.length < 64 || /replace|secret|smoke|password|generate_with/i.test(secret)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must be a non-predictable secret of at least 64 characters in production`,
      });
    }
  }
  if (value.JWT_SECRET === value.JWT_REFRESH_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["JWT_REFRESH_SECRET"], message: "Access and refresh secrets must differ" });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
