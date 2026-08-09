// Job/LlmCall list + detail views -- the admin console's queue monitor and cost-tracking
// screens. Read-only: nothing here mutates a Job or LlmCall row (that's queue.ts/
// processor.ts/drain.ts's job, driven by the actual pipeline, not an admin click).
import express from "express";
import { listJobs, getJobById } from "../../jobs/queue.ts";
import { listLlmCalls, getLlmCallTotals, type LlmCallListFilter } from "../../llm/callLog.ts";

export const adminJobsRouter = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parsePagination(req: express.Request): { limit: number; offset: number } {
  const rawLimit = Number(req.query.limit);
  const rawOffset = Number(req.query.offset);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_LIMIT));
  const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
  return { limit, offset };
}

adminJobsRouter.get("/jobs", async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : undefined;
  const { jobs, total } = await listJobs({ status, batchId }, limit, offset);
  res.json({ jobs, total, limit, offset });
});

adminJobsRouter.get("/jobs/:id", async (req, res) => {
  const job = await getJobById(req.params.id);
  if (!job) {
    res.status(404).json({ error: `Job "${req.params.id}" not found.` });
    return;
  }
  res.json(job);
});

const VALID_ROLES: LlmCallListFilter["role"][] = ["EXPLAINER", "VERIFIER"];
const VALID_PURPOSES: LlmCallListFilter["purpose"][] = ["PRODUCTION", "HEALTH_CHECK"];

adminJobsRouter.get("/llm-calls", async (req, res) => {
  const { limit, offset } = parsePagination(req);
  const rawRole = req.query.role;
  const rawPurpose = req.query.purpose;
  const role = (VALID_ROLES as unknown[]).includes(rawRole) ? (rawRole as LlmCallListFilter["role"]) : undefined;
  const purpose = (VALID_PURPOSES as unknown[]).includes(rawPurpose) ? (rawPurpose as LlmCallListFilter["purpose"]) : undefined;
  const modelId = typeof req.query.modelId === "string" ? req.query.modelId : undefined;
  const { calls, total } = await listLlmCalls({ role, purpose, modelId }, limit, offset);
  res.json({ calls, total, limit, offset });
});

// Not paginated -- see llm/callLog.ts's own comment on why (small, bounded group count).
adminJobsRouter.get("/llm-calls/totals", async (_req, res) => {
  const totals = await getLlmCallTotals();
  res.json({ totals });
});
