import type { NextFunction, Request, Response } from "express";
import { env } from "../env.ts";
import { verifyAuthToken, type AuthTokenPayload } from "./jwt.ts";

const COOKIE_NAME = "cfdi_auth";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthTokenPayload;
  }
}

export { COOKIE_NAME };

/** Populates req.user if a valid cookie is present; 401s otherwise. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = typeof token === "string" ? verifyAuthToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "Unauthorized. Please sign in." });
    return;
  }
  req.user = payload;
  next();
}

/** Must run AFTER requireAuth. 403s a non-ADMIN. Separated from requireAuth (rather than
 *  one combined middleware) so a route can require login without requiring ADMIN, and so
 *  a table-driven authz test (adminAuthz.test.ts) can distinguish 401 (no session) from
 *  403 (session, wrong role) cleanly. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/** Protects POST /internal/drain-queue -- a pre-shared header token, NOT JWT/ADMIN auth.
 *  This endpoint must be reachable by an unauthenticated demo user's browser (fired
 *  fire-and-forget right after /api/explain) and by an optional external keep-warm cron
 *  ping, but must not be open to abuse of a cost-bearing, rate-limited external API. */
export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const provided = req.header("x-internal-token");
  if (provided !== env.INTERNAL_DRAIN_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
