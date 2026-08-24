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

// --- Layer 1: evidence-numeric-fidelity (2026-08-10 hallucination-auditor finding #1) -----
// Regression coverage for a real gap the audit found: neither this file's citation check
// nor Layer 2's LLM prompt (buildVerifierRequest never sends `evidence`) ever verified that
// a NUMBER the prose states actually matches the Finding's real evidence.

const NUMERIC_FINDING: Finding = {
  ruleId: "impuestos-totales-consistencia",
  fieldPath: "Comprobante/Impuestos/@TotalImpuestosTrasladados",
  severity: "error",
  satReference: "Anexo 20, el total debe ser igual a la suma de los importes registrados en Traslados.",
  evidence: { totalTrasladadosDeclarado: "900.00", sumaTraslados: 800, decimales: 2 },
};

test("verifyLayer1: ACCEPTS prose that restates real evidence numbers, formatting differences and all", () => {
  const output: ExplainerOutput = {
    explicacion: "El comprobante declara 900.00, pero la suma real de los traslados es 800.",
    sugerenciaCorreccion: "Ajusta el total a 800.00.",
    citedRuleIds: ["impuestos-totales-consistencia"],
  };
  const result = verifyLayer1(NUMERIC_FINDING, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1: REJECTS a fabricated number in the prose that matches neither evidence nor satReference", () => {
  const output: ExplainerOutput = {
    explicacion: "El comprobante declara 950.00, pero la suma real de los traslados es 800.",
    sugerenciaCorreccion: "Ajusta el total a 800.00.",
    citedRuleIds: ["impuestos-totales-consistencia"],
  };
  const result = verifyLayer1(NUMERIC_FINDING, output);
  assert.equal(result.passed, false);
  assert.equal(result.layer, 1);
  assert.match(result.reason ?? "", /950/);
});

test("verifyLayer1: does NOT tear the digits off an alphanumeric catalog code (regression: 'G03' must not be read as the bare number 3) -- caught live against a real production sample, 2026-08-11", () => {
  const catalogFinding: Finding = {
    ruleId: "regimen-uso-compat",
    fieldPath: "Comprobante/Receptor/@RegimenFiscalReceptor",
    severity: "error",
    satReference: "Catálogo cfdi_40_usos_cfdi: el UsoCFDI G03 solo es válido para ciertos regímenes.",
    evidence: { RegimenFiscalReceptor: "605", UsoCFDI: "G03", regimenesValidos: ["601", "603", "606"] },
  };
  const output: ExplainerOutput = {
    explicacion: "El receptor tiene el régimen 605, pero el UsoCFDI G03 solo admite los regímenes 601, 603 y 606.",
    sugerenciaCorreccion: "Cambie el UsoCFDI o el régimen del receptor para que sean compatibles.",
    citedRuleIds: ["regimen-uso-compat"],
  };
  const result = verifyLayer1(catalogFinding, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1: a version number glued to a letter in satReference ('v4.0') still grounds the same number written with a space in prose ('4.0') -- regression, caught live 2026-08-11", () => {
  const versionedFinding: Finding = {
    ...NUMERIC_FINDING,
    satReference: "Anexo 20 Guía de llenado CFDI v4.0, el total debe coincidir con la suma de Traslados.",
  };
  const output: ExplainerOutput = {
    explicacion: "Según la Guía de llenado del CFDI 4.0, el total declarado 900.00 no coincide con la suma real de 800.",
    sugerenciaCorreccion: "Ajusta el total a 800.00.",
    citedRuleIds: ["impuestos-totales-consistencia"],
  };
  const result = verifyLayer1(versionedFinding, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1: a number appearing only in satReference (not evidence) is still accepted as grounded", () => {
  const withPageRef: Finding = {
    ...NUMERIC_FINDING,
    satReference:
      "Anexo 20 Guía de llenado CFDI v4.0, p. 34-35/123: el total debe coincidir con la suma de Traslados.",
  };
  const output: ExplainerOutput = {
    explicacion: "Según la página 34 del Anexo 20, el total declarado 900.00 no coincide con la suma real de 800.",
    sugerenciaCorreccion: "Ajusta el total a 800.00.",
    citedRuleIds: ["impuestos-totales-consistencia"],
  };
  const result = verifyLayer1(withPageRef, output);
  assert.equal(result.passed, true, result.reason ?? "");
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

// --- Hallucination-auditor findings #3 and #5 (fixed 2026-08-23) --------------------------

// Finding #3: the old citation regex only matched "Art."-prefixed and 2-digit-first
// dotted shapes, so lowercase paraphrases sailed through unbacked and EVERY RMF rule
// number ("2.7.1.34") was invisible to Layer 1.
const RMF_FINDING: Finding = {
  ruleId: "cfdi-cancelado-sat",
  fieldPath: "x",
  severity: "error",
  satReference:
    "RMF 2026, reglas 2.7.1.34 (Aceptación del receptor para la cancelación del CFDI) y CFF Art. 29-A.",
  evidence: { cancelado: true },
};

test("verifyLayer1 #3 regression: a faithful lowercase/accented paraphrase ('artículo 29-A') grounds against 'Art. 29-A'", () => {
  const output: ExplainerOutput = {
    explicacion: "El Art. 29-A regula la cancelación; véase también artículo 29-A del CFF.",
    sugerenciaCorreccion: "Confirma con el emisor.",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1 #3 regression: an INVENTED lowercase citation is no longer invisible", () => {
  const output: ExplainerOutput = {
    explicacion: "Conforme al artículo 999-Z del CFF, esto procede distinto.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, false);
  assert.match(result.reason ?? "", /999-Z/);
});

test("verifyLayer1 #3 regression: an invented single-digit-first RMF number is rejected", () => {
  const output: ExplainerOutput = {
    explicacion: "Aplica la regla 2.7.1.99 de la RMF 2026.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(RMF_FINDING, output);
  assert.equal(result.passed, false);
  assert.match(result.reason ?? "", /2\.7\.1\.99/);
});

test("verifyLayer1 #3 regression: a REAL RMF number quoted from satReference still passes", () => {
  const output: ExplainerOutput = {
    explicacion: "Aplica la regla 2.7.1.34 de la RMF 2026 y el Art. 29-A del CFF.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(RMF_FINDING, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1 #5 regression: an unstated consequence ('el SAT lo rechazaría') is rejected when satReference never says it", () => {
  const output: ExplainerOutput = {
    explicacion: "Este comprobante está cancelado; el SAT lo rechazaría en la declaración anual.",
    sugerenciaCorreccion: "Solicita la cancelación.",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, false);
  assert.match(result.reason ?? "", /consecuencia no respaldada/);
});

test("verifyLayer1 #5: the same consequence phrasing PASSES when satReference itself states it", () => {
  // emisor-efos-69b's real citation contains "no producen ni produjeron efecto fiscal
  // alguno" -- prose restating that loss-of-effect consequence must not be rejected.
  const efosFinding: Finding = {
    ruleId: "emisor-efos-69b",
    fieldPath: "x",
    severity: "error",
    satReference:
      "CFF Art. 69-B: los comprobantes expedidos por ese contribuyente no producen ni produjeron efecto fiscal alguno.",
    evidence: { situacion: "Definitivo" },
  };
  const output: ExplainerOutput = {
    explicacion: "El comprobante sería invalidado: las operaciones no producen efecto fiscal alguno según el Art. 69-B.",
    sugerenciaCorreccion: "No lo utilices como soporte de deducción.",
    citedRuleIds: ["emisor-efos-69b"],
  };
  const result = verifyLayer1(efosFinding, output);
  assert.equal(result.passed, true, result.reason ?? "");
});

test("verifyLayer1 #5: an invented penalty claim is rejected", () => {
  const output: ExplainerOutput = {
    explicacion: "Este comprobante cancelado podría acarrear sanciones al receptor.",
    sugerenciaCorreccion: "N/A",
    citedRuleIds: ["cfdi-cancelado-sat"],
  };
  const result = verifyLayer1(REAL_FINDING, output);
  assert.equal(result.passed, false);
  assert.match(result.reason ?? "", /sanción o consecuencia penal/);
});
