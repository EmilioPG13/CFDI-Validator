// Processes ONE claimed job: Explainer -> Verifier Layer 1 (deterministic) -> Verifier
// Layer 2 (LLM, only if Layer 1 passed) -> persist. Deterministic layer first, model
// layer second, per the Phase 5 plan's required order -- Layer 1 never burns a
// rate-limited LLM call verifying output already known to be wrong.
import { prisma } from "../prismaClient.ts";
import { provider } from "../llm/rateLimitedProvider.ts";
import { resolveSetting } from "../settings/resolver.ts";
import { buildExplainerRequest, type ExplainerOutput } from "../prompts/explainer.ts";
import { verifyLayer1, verifyLayer2 } from "../prompts/verifier.ts";
import { markJobDone, markJobRejected, markJobFailed, type QueuedJob } from "./queue.ts";

// Defaults matter here: even a fresh install with nothing ever written to
// model.explainer/model.verifier must not violate the different-model-family
// requirement (prompts/verifier.ts's assertDifferentModelFamily) -- these two are
// deliberately different NIM orgs, mirroring job-search-agents' own measured-good tiers
// (FAST for the narrow, structured Explainer task; a different family for the Verifier).
export const DEFAULT_EXPLAINER_MODEL = "meta/llama-3.1-8b-instruct";
export const DEFAULT_VERIFIER_MODEL = "mistralai/mistral-medium-3.5-128b";

async function logLlmCall(
  jobId: string,
  role: "EXPLAINER" | "VERIFIER",
  modelId: string,
  usage: { promptTokens: number; completionTokens: number },
  latencyMs: number,
): Promise<void> {
  await prisma.llmCall.create({
    data: {
      jobId,
      role: role as never,
      purpose: "PRODUCTION",
      modelId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      latencyMs,
    },
  });
}

export async function processJob(job: QueuedJob): Promise<void> {
  try {
    const explainerModel = (await resolveSetting("model.explainer", DEFAULT_EXPLAINER_MODEL)).value;
    const verifierModel = (await resolveSetting("model.verifier", DEFAULT_VERIFIER_MODEL)).value;

    const explainerResult = await provider.chatCompletion(
      buildExplainerRequest(job.findingPayload, explainerModel),
    );
    await logLlmCall(job.id, "EXPLAINER", explainerModel, explainerResult.usage, explainerResult.latencyMs);

    const output = explainerResult.data as ExplainerOutput | null;
    if (!output || typeof output.explicacion !== "string" || !Array.isArray(output.citedRuleIds)) {
      await markJobFailed(job.id, "Explainer no devolvió JSON con la forma esperada.", job.attempts);
      return;
    }

    const layer1 = verifyLayer1(job.findingPayload, output);
    if (!layer1.passed) {
      await markJobRejected(job.id, layer1.reason ?? "Rechazado en Layer 1.", 1);
      return;
    }

    const layer2Started = Date.now();
    const layer2 = await verifyLayer2(provider, job.findingPayload, output, verifierModel);
    // verifyLayer2 doesn't expose raw usage (it returns a VerifierResult, not a
    // ChatCompletionResult) -- log a call with the wall-clock time measured here; the
    // token counts are a known, acceptable gap for this first cut, noted rather than
    // silently absent from Job/LlmCall's own "why is this entry missing usage" question.
    await logLlmCall(job.id, "VERIFIER", verifierModel, { promptTokens: 0, completionTokens: 0 }, Date.now() - layer2Started);

    if (!layer2.passed) {
      await markJobRejected(job.id, layer2.reason ?? "Rechazado en Layer 2.", 2);
      return;
    }

    await markJobDone(job.id, output.explicacion, output.sugerenciaCorreccion, output.citedRuleIds);
  } catch (err) {
    await markJobFailed(job.id, err instanceof Error ? err.message : String(err), job.attempts);
  }
}
