// No public registration endpoint exists here, deliberately -- and never should. The
// only way an ADMIN account gets created is prisma/seed.ts, run out-of-band against
// SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD. If a self-serve signup is ever added for the
// admin console's own users, it must default role: USER unconditionally -- see the
// User model in schema.prisma and the Phase 5 plan's "no public endpoint can ever
// create an ADMIN" requirement.
import express from "express";
import { prisma } from "../prismaClient.ts";
import { env } from "../env.ts";
import { verifyPassword } from "./password.ts";
import { signAuthToken, verifyAuthToken } from "./jwt.ts";
import { COOKIE_NAME } from "./middleware.ts";

export const authRouter = express.Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.IS_PRODUCTION,
  // See env.ts's IS_PRODUCTION comment -- SameSite=None+Secure in production (the
  // Vercel<->Render cross-site case), SameSite=Lax without Secure for local dev.
  sameSite: env.IS_PRODUCTION ? ("none" as const) : ("lax" as const),
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Same error message whether the email doesn't exist or the password is wrong --
  // don't let this endpoint be used to enumerate registered emails.
  const invalid = () => res.status(401).json({ error: "Invalid email or password" });

  if (!user) {
    invalid();
    return;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    invalid();
    return;
  }

  const token = signAuthToken({ userId: user.id, role: user.role });
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
  res.json({ id: user.id, email: user.email, role: user.role });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, COOKIE_OPTIONS);
  res.status(204).end();
});

authRouter.get("/me", (req, res) => {
  // Deliberately does not use requireAuth -- a 200/null response for "not logged in" is
  // more convenient for the frontend's own session-check-on-load than a 401 it has to
  // special-case. Routes that actually need auth use requireAuth, not this one.
  const token = req.cookies?.[COOKIE_NAME];
  const payload = typeof token === "string" ? verifyAuthToken(token) : null;
  res.json({ user: payload });
});
