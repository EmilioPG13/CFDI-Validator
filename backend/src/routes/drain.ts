// Protected by a pre-shared header token (auth/middleware.ts's requireInternalToken),
// NOT JWT/ADMIN auth -- must be reachable by an unauthenticated demo user's browser
// (fired fire-and-forget right after POST /api/explain) and an optional external
// keep-warm cron ping, but not open to abuse of a cost-bearing, rate-limited API.
import express from "express";
import { requireInternalToken } from "../auth/middleware.ts";
import { drainQueue } from "../jobs/drain.ts";

export const drainRouter = express.Router();

drainRouter.post("/drain-queue", requireInternalToken, async (req, res) => {
  const max = Number(req.query.max) || 1;
  const result = await drainQueue(max);
  res.json(result);
});
