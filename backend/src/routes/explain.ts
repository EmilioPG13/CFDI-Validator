// POST /api/explain never calls the LLM inline -- a single Explainer call can take
// 100+ seconds on NIM's free tier; stacking several sequentially inside one HTTP request
// risks whatever timeout the host imposes. It only creates Job rows and returns 202
// immediately. The frontend fires POST /internal/drain-queue right after, fire-and-forget
// (routes/drain.ts), and polls GET /api/explain/:batchId for results.
import express from "express";
import { randomUUID } from "node:crypto";
import { createJobsForBatch, getJobsByBatch } from "../jobs/queue.ts";
import type { Finding } from "../../../engine/src/finding.ts";

export const explainRouter = express.Router();

// Defense-in-depth, not the primary control: the primary control is client-side
// redaction (frontend/src/lib/redact.ts), run before this request is ever sent. This is
// a backstop against a client-side bug -- reject the whole batch outright (fail loud)
// rather than silently stripping, so a redaction regression is immediately visible
// instead of quietly "fixed" server-side where nobody would notice it broke.
const RFC_PATTERN = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function looksUnredacted(finding: Finding): boolean {
  const blob = JSON.stringify(finding.evidence);
  return RFC_PATTERN.test(blob) || UUID_PATTERN.test(blob);
}

function isValidFinding(value: unknown): value is Finding {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.ruleId === "string" &&
    typeof f.fieldPath === "string" &&
    (f.severity === "error" || f.severity === "warning") &&
    typeof f.satReference === "string" &&
    "evidence" in f
  );
}

explainRouter.post("/explain", async (req, res) => {
  const { findings } = req.body ?? {};
  if (!Array.isArray(findings) || findings.length === 0 || !findings.every(isValidFinding)) {
    res.status(400).json({ error: "Body must include a non-empty array of Finding objects." });
    return;
  }

  const unredacted = findings.filter(looksUnredacted);
  if (unredacted.length > 0) {
    res.status(400).json({
      error:
        "One or more findings appear to contain an unredacted RFC or UUID in evidence. " +
        "This should never happen if the client redacted correctly -- rejected, not silently stripped.",
    });
    return;
  }

  const batchId = randomUUID();
  await createJobsForBatch(batchId, findings);
  res.status(202).json({ batchId, count: findings.length });
});

explainRouter.get("/explain/:batchId", async (req, res) => {
  const jobs = await getJobsByBatch(req.params.batchId);
  res.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      findingRuleId: j.findingRuleId,
      // A rejected job must render as "explicación no disponible" client-side -- never
      // as an absent row indistinguishable from "nothing to explain here." Same
      // principle pipeline.ts's own satUnverified already enforces one level up.
      explanation: j.status === "done" ? j.explanation : null,
      suggestedFix: j.status === "done" ? j.suggestedFix : null,
      unavailable: j.status === "rejected" || j.status === "failed",
    })),
  });
});
