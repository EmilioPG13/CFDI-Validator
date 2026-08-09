import jwt from "jsonwebtoken";
import { env } from "../env.ts";

export interface AuthTokenPayload {
  userId: string;
  role: "USER" | "ADMIN";
}

const EXPIRES_IN = "7d";

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRES_IN });
}

/** Returns null on any verification failure (expired, malformed, wrong secret) rather
 *  than throwing -- callers (auth middleware) treat "invalid token" and "no token" the
 *  same way: unauthenticated, not a 500. */
export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      "userId" in decoded &&
      "role" in decoded
    ) {
      return decoded as AuthTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
