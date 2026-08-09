// Zero DB dependency -- verifyLayer1 reads the REAL engine/rules/registry.json (not
// mocked; this is deliberate, it's the actual allowlist Layer 1 must check against, and
// it's a static file read, not a live DB call). verifyLayer2 uses a fake LlmProvider.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Finding } from "../../engine/src/finding.ts";
import {
  verifyLayer1,
  verifyLayer2,
  assertDifferentModelFamily,
  getModelFamily,
  SameModelFamilyError,
} from "../src/prompts/verifier.ts";
import type { ExplainerOutput } from "../src/prompts/explainer.ts";
import type { LlmProvider } from "../src/llm/provider.ts";

const REAL_FINDING: Finding = {
  ruleId: "cfdi-cancelado-sat",
  fieldPath: "Comprobante/Complemento/TimbreFiscalDigital/@UUID",
  severity: "error",
  satReference: "CFF Art. 29-A. Los comprobantes fiscales digitales por Internet se podrán cancelar...",
  evidence: { cancelado: true },
};

// --- Layer 1 (deterministic) -------------------------------------------------------------

test("verifyLayer1: rejects an invented citedRuleId not present in the real rule catalog", () => {
  const output: ExplainerOutput = {
    explicacion: "Este comprobante está cancelado según el SAT.",
    sugerenciaCorreccion: "Verifica con el emisor.",
    citedRuleIds: ["cfdi-cancelado-sat", "regla-inventada-que-no-existe"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, false);
  assert.equal(result.layer, 1);
  assert.match(result.reason ?? "", /regla-inventada-que-no-existe/);
});

test("verifyLayer1: rejects an invented article-number-shaped citation not present in satReference", () => {
  const output: ExplainerOutput = {
    explicacion: "Este comprobante viola el Art. 999-Z del CFF, lo cual es inusual.",
    sugerenciaCorreccion: "Consulta el Art. 999-Z para más detalles.",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, false);
  assert.equal(result.layer, 1);
  assert.match(result.reason ?? "", /999-Z/);
});

test("verifyLayer1: ACCEPTS a well-formed, citation-faithful explanation -- positive control", () => {
  const output: ExplainerOutput = {
    explicacion:
      "Este comprobante está cancelado según el SAT. El Art. 29-A del CFF regula la cancelación de CFDI.",
    sugerenciaCorreccion: "Confirma con el emisor si la cancelación fue aceptada.",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1: an explanation with no citations at all and no unknown ruleIds passes (nothing to reject)", () => {
  const output: ExplainerOutput = {
    explicacion: "Este comprobante está cancelado.",
    sugerenciaCorreccion: "Contacta al emisor.",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, true);
});

// --- Layer 2 (LLM, semantic) --------------------------------------------------------------

function fakeProviderReturning(data: unknown): LlmProvider {
  return {
    name: "fake",
    async listModels() {
      return [];
    },
    async chatCompletion() {
      return {
        text: JSON.stringify(data),
        data,
        usedJsonSchemaMode: true,
        finishReason: "stop",
        usage: { promptTokens: 50, completionTokens: 20 },
        latencyMs: 100,
        model: "fake/model",
      };
    },
  };
}

test("verifyLayer2: rejects when the model reports overstates:true", async () => {
  const provider = fakeProviderReturning({ overstates: true, reasoning: "La prosa afirma más de lo que dice satReference." });
  const output: ExplainerOutput = {
    explicacion: "Este comprobante fue cancelado DESPUÉS de que el receptor lo dedujo.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = await verifyLayer2(provider, REAL_FINDING, output, "fake/model");
  assert.equal(result.passed, false);
  assert.equal(result.layer, 2);
  assert.match(result.reason ?? "", /afirma más/);
});

test("verifyLayer2: accepts when the model reports overstates:false", async () => {
  const provider = fakeProviderReturning({ overstates: false, reasoning: "La prosa es fiel a satReference." });
  const output: ExplainerOutput = {
    explicacion: "Este comprobante está cancelado actualmente según el SAT.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = await verifyLayer2(provider, REAL_FINDING, output, "fake/model");
  assert.equal(result.passed, true);
});

test("verifyLayer2: a model returning no parseable JSON is rejected, not silently treated as passing", async () => {
  const provider = fakeProviderReturning(null);
  const output: ExplainerOutput = { explicacion: "x", sugerenciaCorreccion: "y", citedRuleIds: [] };
  const result = await verifyLayer2(provider, REAL_FINDING, output, "fake/model");
  assert.equal(result.passed, false);
});

// --- Different-model-family enforcement ----------------------------------------------------

test("getModelFamily: extracts the org prefix before the slash", () => {
  assert.equal(getModelFamily("meta/llama-3.1-8b-instruct"), "meta");
  assert.equal(getModelFamily("mistralai/mistral-medium-3.5-128b"), "mistralai");
});

test("assertDifferentModelFamily: rejects assigning the same family to both roles", () => {
  assert.throws(
    () => assertDifferentModelFamily("meta/llama-3.1-8b-instruct", "meta/llama-3.3-70b-instruct"),
    SameModelFamilyError,
  );
});

test("assertDifferentModelFamily: accepts genuinely different families", () => {
  assert.doesNotThrow(() =>
    assertDifferentModelFamily("meta/llama-3.1-8b-instruct", "mistralai/mistral-medium-3.5-128b"),
  );
});
