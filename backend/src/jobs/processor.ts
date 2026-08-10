// Processes ONE claimed job: Explainer -> Verifier Layer 1 (deterministic) -> Verifier
// Layer 2 (LLM, only if Layer 1 passed) -> persist. Deterministic layer first, model
// layer second, per the Phase 5 plan's required order -- Layer 1 never burns a
// rate-limited LLM call verifying output already known to be wrong.
import { prisma } from "../prismaClient.ts";
import { provider } from "../llm/rateLimitedProvider.ts";
import { resolveSetting } from "../settings/resolver.ts";
import { resolveActivePromptBody } from "../prompts/store.ts";
import { buildExplainerRequest, EXPLAINER_SYSTEM_PROMPT, type ExplainerOutput } from "../prompts/explainer.ts";
import { verifyLayer1, verifyLayer2, VERIFIER_SYSTEM_PROMPT } from "../prompts/verifier.ts";
import { markJobDone, markJobRejected, markJobFailed, type QueuedJob } from "./queue.ts";

// Defaults matter here: even a fresh install with nothing ever written to
// model.explainer/model.verifier must not violate the different-model-family
// requirement (prompts/verifier.ts's assertDifferentModelFamily) -- these two are
// deliberately different NIM orgs.
//
// Changed from the original Phase 5 picks (meta/llama-3.1-8b-instruct,
// mistralai/mistral-medium-3.5-128b) after a live production incident: the original
// DEFAULT_VERIFIER_MODEL had gone stale on NIM's own catalog (410 Gone -- deprecated
// sometime after Phase 5d, before this was ever exercised against a real chat-completions
// call in production) and would have silently blocked every explanation forever, since
// nothing on this backend's own side would ever detect a code-level default going bad --
// the health-check gate only applies to an explicit admin PUT, never to a default that's
// simply never been assigned. Caught and fixed live, Phase 5e's production verification:
// health-checked and load-tested several current catalog entries per role before landing
// on these two. openai/gpt-oss-120b was tried for VERIFIER first -- it passed the health
// probe (a simple {saludo} schema) but reliably failed to return parseable JSON against
// the Verifier's own (more demanding) schema, 2/2 real attempts -- a genuine reminder that
// a health check is one sample against one schema, not a guarantee for every prompt shape.
export const DEFAULT_EXPLAINER_MODEL = "z-ai/glm-5.2";
export const DEFAULT_VERIFIER_MODEL = "minimaxai/minimax-m3";

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
    // Sub-phase 5e: an admin-activated PromptVersion (prompts/store.ts) overrides the
    // in-code fallback here -- prompt-source-agnostic by construction, same reasoning as
    // Verifier Layer 1 validating a runtime value regardless of which prompt produced it
    // (see prompts/store.ts's header comment).
    const explainerPrompt = (await resolveActivePromptBody("explainer.system", EXPLAINER_SYSTEM_PROMPT)).body;
    const verifierPrompt = (await resolveActivePromptBody("verifier.system", VERIFIER_SYSTEM_PROMPT)).body;

    const explainerResult = await provider.chatCompletion(
      buildExplainerRequest(job.findingPayload, explainerModel, explainerPrompt),
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
    const layer2 = await verifyLayer2(provider, job.findingPayload, output, verifierModel, verifierPrompt);
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
