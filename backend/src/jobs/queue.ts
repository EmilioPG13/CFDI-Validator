// Status-column queue, same free-text-status convention as job-search-agents' own jobs
// table (deliberately not a DB enum -- a fast-evolving lifecycle: pending -> processing
// -> done | rejected | failed).
//
// ATOMIC CLAIM is a deliberate departure from job-search-agents' simpler SELECT-then-
// UPDATE pattern (safe there because it's a CLI run one process at a time). This backend
// does NOT have that guarantee: /internal/drain-queue is reactive, triggered by a
// fire-and-forget browser call AND an optional external keep-warm cron ping, both of
// which can land as genuinely concurrent HTTP requests on the same Node process,
// interleaving at await points. Two concurrent drains doing plain SELECT-then-UPDATE
// could both read the same "pending" row before either writes, double-processing (and
// double-billing) it. FOR UPDATE SKIP LOCKED gives correctness almost for free -- the
// cost of getting this wrong is a duplicated, rate-limited, money-costing LLM call, not
// a re-run CLI job.
import { prisma } from "../prismaClient.ts";
import type { Finding } from "../../../engine/src/finding.ts";

export interface QueuedJob {
  id: string;
  batchId: string;
  status: string;
  findingRuleId: string;
  findingPayload: Finding;
  attempts: number;
}

/** One Job per Finding, all sharing a server-generated batchId. Findings are expected to
 *  already be client-redacted (frontend/src/lib/redact.ts) -- this function does not
 *  re-redact; routes/explain.ts's own defensive check (see that file) is the backstop
 *  against a client-side bug, not this one. */
export async function createJobsForBatch(batchId: string, findings: Finding[]): Promise<void> {
  await prisma.job.createMany({
    data: findings.map((finding) => ({
      batchId,
      status: "pending",
      findingRuleId: finding.ruleId,
      findingPayload: finding as unknown as never,
    })),
  });
}

/** Atomically claims up to `n` pending jobs, marking them "processing" in the same
 *  statement. Uses $queryRaw because Prisma's query builder can't express
 *  FOR UPDATE SKIP LOCKED directly. */
export async function claimPendingJobs(n: number): Promise<QueuedJob[]> {
  const rows = await prisma.$queryRaw<
    { id: string; batchId: string; status: string; findingRuleId: string; findingPayload: unknown; attempts: number }[]
  >`
    UPDATE "Job" SET status = 'processing', "claimedAt" = now(), "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'pending'
      ORDER BY "createdAt" ASC
      LIMIT ${n}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "batchId", status, "findingRuleId", "findingPayload", attempts;
  `;
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batchId,
    status: r.status,
    findingRuleId: r.findingRuleId,
    findingPayload: r.findingPayload as Finding,
    attempts: r.attempts,
  }));
}

async function recordEvent(jobId: string, fromStatus: string, toStatus: string, reason: string | null): Promise<void> {
  await prisma.jobEvent.create({ data: { jobId, fromStatus, toStatus, reason } });
}

export async function markJobDone(
  jobId: string,
  explanation: string,
  suggestedFix: string,
  citedRuleIds: string[],
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "done", explanation, suggestedFix, citedRuleIds: citedRuleIds as unknown as never },
  });
  await recordEvent(jobId, "processing", "done", null);
}

/** Rejected by the Verifier (either layer). Must never be indistinguishable from "no
 *  finding here" client-side -- see prompts/verifier.ts's own header comment on why. */
export async function markJobRejected(jobId: string, reason: string, layer: 1 | 2 | null): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "rejected", verifierNotes: { reason, layer } as unknown as never },
  });
  await recordEvent(jobId, "processing", "rejected", reason);
}

/** A genuine error (LLM call threw, timed out, etc.) -- distinct from "rejected", which
 *  means the pipeline worked but the output failed verification. Row stays retryable:
 *  attempts increments, status goes back to "pending" (matching job-search-agents' own
 *  "row stays at its current status so the next run retries it" pattern) unless the
 *  attempt count has already been exhausted. */
const MAX_ATTEMPTS = 3;

export async function markJobFailed(jobId: string, error: string, currentAttempts: number): Promise<void> {
  const attempts = currentAttempts + 1;
  const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
  await prisma.job.update({
    where: { id: jobId },
    data: { status, attempts, lastError: error },
  });
  await recordEvent(jobId, "processing", status, error);
}

export async function getJobsByBatch(batchId: string) {
  return prisma.job.findMany({ where: { batchId }, orderBy: { createdAt: "asc" } });
}

// --- Admin list/detail views (Sub-phase 5e) ----------------------------------------------
// No injectable-repo seam here, deliberately -- same precedent as every function above in
// this file (createJobsForBatch, claimPendingJobs, etc.): Job/JobEvent data access always
// goes through the shared `prisma` singleton directly, with jobQueue.test.ts (gated on
// DATABASE_URL_TEST) as the one place this module gets tested against a real DB rather
// than a fake. Unlike SettingsRepo/ModelHealthRepo, nothing here needed swapping for a
// fake in a unit test.

export interface JobListFilter {
  status?: string;
  batchId?: string;
}

export async function listJobs(filter: JobListFilter, limit: number, offset: number) {
  const where = {
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.batchId ? { batchId: filter.batchId } : {}),
  };
  const [jobs, total] = await Promise.all([
    prisma.job.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.job.count({ where }),
  ]);
  return { jobs, total };
}

/** Includes JobEvent history and LlmCall rows -- the admin console's job detail view is
 *  also the cost-tracking drill-down (how many LLM calls, what tokens, for this job). */
export async function getJobById(id: string) {
  return prisma.job.findUnique({
    where: { id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      llmCalls: { orderBy: { createdAt: "asc" } },
    },
  });
}
