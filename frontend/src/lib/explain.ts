// Orchestrates the "Explicar" flow for ONE Finding: redact -> create a one-finding batch
// -> fire-and-forget drain -> poll until the job settles.
//
// One finding per batch, deliberately -- GET /api/explain/:batchId only echoes back
// findingRuleId per job (backend/src/routes/explain.ts), not a stable per-finding index,
// so a multi-finding batch has no reliable way to correlate a specific returned
// explanation back to a specific Finding when two findings in the same batch share a
// ruleId -- a real possibility (many line items across one ZIP can trip the same rule).
// One finding per batch sidesteps the ambiguity entirely, and drain already only
// processes `max` (default 1) job per call regardless of batch size -- nothing is lost by
// not batching.
import { redactFindingForExplainer } from "./redact";
import { postExplainBatch, getExplainBatch, drainQueue, BackendApiError, type ExplainJobResult } from "./backendApi";
import type { Finding } from "../../../engine/src/finding.ts";

export type ExplainResult =
  | { status: "done"; explanation: string; suggestedFix: string }
  | { status: "unavailable"; reason: string }
  | { status: "timeout" }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 3000;
// NIM's free tier can take 100+ seconds for a single trivial call (empirically normal,
// not a bug -- see CLAUDE.md's Phase 5 notes), and this flow runs Explainer THEN Verifier
// Layer 2 sequentially. Budget generously rather than timing out a request that was
// actually still working.
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function explainFinding(finding: Finding): Promise<ExplainResult> {
  try {
    const redacted = redactFindingForExplainer(finding);
    const { batchId } = await postExplainBatch([redacted]);

    // NOT awaited before polling starts -- drainQueue's own HTTP response only resolves
    // once the claimed job finishes processing (backend/src/jobs/drain.ts awaits
    // processJob inline), which can itself be 100+ seconds. The poll loop below learns
    // the outcome independently, the moment the Job row's status actually changes,
    // regardless of when (or whether) this call's own response arrives.
    void drainQueue().catch(() => {
      // A failed drain call isn't fatal here -- the poll loop just keeps seeing "pending"
      // and eventually times out below, which is the correct degraded behavior (an
      // external keep-warm ping or a later retry could still process the job; this
      // call's own failure doesn't mean the job is lost).
    });

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { jobs } = await getExplainBatch(batchId);
      const job: ExplainJobResult | undefined = jobs[0];
      if (job) {
        if (job.status === "done" && job.explanation) {
          return { status: "done", explanation: job.explanation, suggestedFix: job.suggestedFix ?? "" };
        }
        if (job.unavailable) {
          return {
            status: "unavailable",
            reason:
              "No se pudo generar una explicación verificada para este hallazgo. Esto no significa que el hallazgo sea incorrecto — la explicación automática no pasó nuestras validaciones internas.",
          };
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: "timeout" };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof BackendApiError ? err.message : "No se pudo solicitar la explicación.",
    };
  }
}
