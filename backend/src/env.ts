// Typed env loading, fails fast at process start rather than lazily at first use. A
// backend that silently issues JWTs signed with `undefined`, or that silently no-ops on a
// missing DATABASE_URL, is a worse failure mode than one that refuses to boot -- see
// backend/.env.example's own header comment for the same reasoning stated to whoever
// deploys this.
import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[env] Missing required environment variable: ${name}. See backend/.env.example.`,
    );
  }
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  NVIDIA_API_KEY: required("NVIDIA_API_KEY"),
  NIM_BASE_URL: process.env.NIM_BASE_URL?.trim() || "https://integrate.api.nvidia.com/v1",
  NIM_RPM_LIMIT: Number(process.env.NIM_RPM_LIMIT) || 32,
  JWT_SECRET: required("JWT_SECRET"),
  FRONTEND_URL: required("FRONTEND_URL"),
  INTERNAL_DRAIN_TOKEN: required("INTERNAL_DRAIN_TOKEN"),
  PORT: Number(process.env.PORT) || 3001,
  // Render/most hosts set NODE_ENV=production automatically; local dev typically doesn't
  // set it at all. Drives the auth cookie's Secure flag (auth/routes.ts) -- SameSite=None
  // REQUIRES Secure or browsers reject the cookie outright, but Secure cookies aren't
  // sent over plain http://localhost, so local dev needs the opposite combination
  // (SameSite=Lax, not Secure). Getting this wrong doesn't error locally; it just
  // silently drops the cookie in whichever environment doesn't match -- verify against
  // the real deployed origins, not only localhost, before considering auth done (see
  // CLAUDE.md's Phase 5 CORS note).
  IS_PRODUCTION: process.env.NODE_ENV === "production",
} as const;
