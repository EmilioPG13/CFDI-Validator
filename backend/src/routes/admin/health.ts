import express from "express";
import { provider } from "../../llm/rateLimitedProvider.ts";
import { assertModelAllowed, ModelNotAllowedError } from "../../llm/modelCatalog.ts";
import { runHealthProbe, prismaModelHealthRepo, type LlmRoleName } from "../../llm/healthProbe.ts";
import { prisma } from "../../prismaClient.ts";

export const adminHealthRouter = express.Router();

const VALID_ROLES: LlmRoleName[] = ["EXPLAINER", "VERIFIER"];

// One button click = one probe against the one model selected for one role -- never a
// loop over the catalog, per the Phase 5 plan. Goes through the SAME rate-limited
// provider as every other call (rateLimitedProvider.ts), so this doesn't need its own
// pacing logic.
adminHealthRouter.post("/health-check", async (req, res) => {
  const { modelId, role } = req.body ?? {};
  if (typeof modelId !== "string" || !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: "modelId (string) and role (EXPLAINER|VERIFIER) are required" });
    return;
  }

  try {
    await assertModelAllowed(modelId);
  } catch (err) {
    if (err instanceof ModelNotAllowedError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }

  const result = await runHealthProbe(provider, modelId);
  await prismaModelHealthRepo.upsert(modelId, role, result);

  // Health checks go through the same rate limiter as production traffic and cost real
  // tokens -- logged as an LlmCall with purpose: HEALTH_CHECK so cost/rate-limit
  // accounting includes probes, per the Phase 5 plan's explicit requirement.
  if (result.usage) {
    await prisma.llmCall.create({
      data: {
        role: role as never,
        purpose: "HEALTH_CHECK",
        modelId,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: result.latencyMs ?? 0,
      },
    });
  }

  res.json(result);
});
