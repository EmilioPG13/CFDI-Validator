// Zero DB/network dependency -- fake LlmProvider and fake ModelHealthRepo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runHealthProbe,
  assertModelHealthyForRole,
  ModelNotHealthyError,
  type ModelHealthRepo,
  type HealthProbeResult,
} from "../src/llm/healthProbe.ts";
import type { LlmProvider } from "../src/llm/provider.ts";

function fakeRepo(): ModelHealthRepo & { rows: Map<string, HealthProbeResult> } {
  const rows = new Map<string, HealthProbeResult>();
  return {
    rows,
    async upsert(modelId, role, result) {
      rows.set(`${modelId}::${role}`, result);
    },
    async findLatest(modelId, role) {
      return rows.get(`${modelId}::${role}`) ?? null;
    },
  };
}

test("runHealthProbe: a model that honors jsonSchema and replies in Spanish is marked healthy", async () => {
  const provider: LlmProvider = {
    name: "fake",
    async listModels() {
      return [];
    },
    async chatCompletion() {
      return {
        text: '{"saludo":"Buenos días"}',
        data: { saludo: "Buenos días" },
        usedJsonSchemaMode: true,
        finishReason: "stop",
        usage: { promptTokens: 20, completionTokens: 5 },
        latencyMs: 500,
        model: "some/model",
      };
    },
  };
  const result = await runHealthProbe(provider, "some/model");
  assert.equal(result.reachable, true);
  assert.equal(result.supportsJsonSchema, true);
  assert.equal(result.spanishOk, true);
  assert.deepEqual(result.usage, { promptTokens: 20, completionTokens: 5 });
});

test("runHealthProbe: a model that IGNORES jsonSchema (falls back, replies in prose) is marked unhealthy for structured output -- this is the check that matters most", async () => {
  const provider: LlmProvider = {
    name: "fake",
    async listModels() {
      return [];
    },
    async chatCompletion() {
      // Simulates nimProvider.ts's json_object fallback path: usedJsonSchemaMode false,
      // and here the model additionally just replied in unstructured prose (data: null)
      // -- the worst failure mode, since nothing throws.
      return {
        text: "¡Hola! ¿Cómo estás hoy?",
        data: null,
        usedJsonSchemaMode: false,
        finishReason: "stop",
        usage: { promptTokens: 20, completionTokens: 8 },
        latencyMs: 900,
        model: "some/model",
      };
    },
  };
  const result = await runHealthProbe(provider, "some/model");
  assert.equal(result.reachable, true);
  assert.equal(result.supportsJsonSchema, false);
});

test("runHealthProbe: an unreachable model is reported, not thrown", async () => {
  const provider: LlmProvider = {
    name: "fake",
    async listModels() {
      return [];
    },
    async chatCompletion() {
      throw new Error("connection refused");
    },
  };
  const result = await runHealthProbe(provider, "some/model");
  assert.equal(result.reachable, false);
  assert.equal(result.supportsJsonSchema, false);
  assert.equal(result.usage, null);
  assert.match(result.error ?? "", /connection refused/);
});

test("assertModelHealthyForRole: rejects a model never health-checked for that role", async () => {
  const repo = fakeRepo();
  await assert.rejects(
    assertModelHealthyForRole("meta/llama-3.1-8b-instruct", "EXPLAINER", repo),
    ModelNotHealthyError,
  );
});

test("assertModelHealthyForRole: rejects a model whose latest check shows supportsJsonSchema:false -- this is what makes the health check an enforced gate, not just a UI hint", async () => {
  const repo = fakeRepo();
  await repo.upsert("nvidia/llama-3.3-nemotron-super-49b-v1.5", "EXPLAINER", {
    reachable: true,
    supportsJsonSchema: false,
    latencyMs: 300,
    spanishOk: true,
    sample: "prose reply",
    error: null,
    usage: { promptTokens: 10, completionTokens: 5 },
  });

  await assert.rejects(
    assertModelHealthyForRole("nvidia/llama-3.3-nemotron-super-49b-v1.5", "EXPLAINER", repo),
    ModelNotHealthyError,
  );
});

test("assertModelHealthyForRole: accepts a model whose latest check shows supportsJsonSchema:true", async () => {
  const repo = fakeRepo();
  await repo.upsert("mistralai/mistral-medium-3.5-128b", "VERIFIER", {
    reachable: true,
    supportsJsonSchema: true,
    latencyMs: 58_000,
    spanishOk: true,
    sample: "Buenos días",
    error: null,
    usage: { promptTokens: 20, completionTokens: 5 },
  });

  await assert.doesNotReject(assertModelHealthyForRole("mistralai/mistral-medium-3.5-128b", "VERIFIER", repo));
});

test("assertModelHealthyForRole: health for one role does not imply health for the other -- each (modelId, role) pair is independent", async () => {
  const repo = fakeRepo();
  await repo.upsert("meta/llama-3.1-8b-instruct", "EXPLAINER", {
    reachable: true,
    supportsJsonSchema: true,
    latencyMs: 400,
    spanishOk: true,
    sample: "Hola",
    error: null,
    usage: { promptTokens: 15, completionTokens: 4 },
  });

  await assert.doesNotReject(assertModelHealthyForRole("meta/llama-3.1-8b-instruct", "EXPLAINER", repo));
  await assert.rejects(
    assertModelHealthyForRole("meta/llama-3.1-8b-instruct", "VERIFIER", repo),
    ModelNotHealthyError,
  );
});
