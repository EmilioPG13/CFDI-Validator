// The tailorPrompt.test.js analogue (cv-tailor/server/routes/tailorPrompt.test.js, read
// directly this session): asserts a forbidden phrase is ABSENT, asserts the required
// constraint is PRESENT, and asserts its position falls strictly between the
// factual-rules and style-rules headers via indexOf bounds -- not just "exists somewhere."
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPLAINER_SYSTEM_PROMPT } from "../src/prompts/explainer.ts";
import { VERIFIER_SYSTEM_PROMPT } from "../src/prompts/verifier.ts";
import { assertPromptStructurallySafe, assertClauseInFactualSection, PromptStructureError } from "../src/prompts/structuralChecks.ts";

for (const [label, prompt] of [
  ["Explainer", EXPLAINER_SYSTEM_PROMPT],
  ["Verifier", VERIFIER_SYSTEM_PROMPT],
] as const) {
  test(`${label} prompt: passes assertPromptStructurallySafe (no escape hatch, factual before style)`, () => {
    assert.doesNotThrow(() => assertPromptStructurallySafe(prompt));
  });

  test(`${label} prompt: does not license inventing/using outside knowledge`, () => {
    assert.doesNotMatch(prompt, /\btu conocimiento\b/i);
    assert.doesNotMatch(prompt, /completa con lo que sepas/i);
  });

  test(`${label} prompt: REGLAS FACTUALES appears before REGLAS DE REDACCIÓN`, () => {
    const factualIdx = prompt.indexOf("REGLAS FACTUALES");
    const styleIdx = prompt.indexOf("REGLAS DE REDACCIÓN");
    assert.ok(factualIdx >= 0, "REGLAS FACTUALES header must be present");
    assert.ok(styleIdx >= 0, "REGLAS DE REDACCIÓN header must be present");
    assert.ok(factualIdx < styleIdx, "factual rules must come before style rules");
  });
}

test("Explainer prompt: the anti-fabrication clause sits inside the factual section, not the style section", () => {
  assert.doesNotThrow(() =>
    assertClauseInFactualSection(
      EXPLAINER_SYSTEM_PROMPT,
      /Nunca completes informaci[oó]n fiscal faltante/,
      "no-knowledge-fallback clause",
    ),
  );
});

test("Explainer prompt: still requires using the given ruleId verbatim (regression guard against a well-meaning edit removing it)", () => {
  assert.match(EXPLAINER_SYSTEM_PROMPT, /ruleId proporcionado tal cual/);
});

test("assertPromptStructurallySafe: rejects a prompt with a knowledge-fallback escape hatch, even if it otherwise looks well-formed", () => {
  const bad = `REGLAS FACTUALES:
1. Si no tienes información suficiente, usa tu conocimiento de la ley para completar.

REGLAS DE REDACCIÓN:
- Sé breve.`;
  assert.throws(() => assertPromptStructurallySafe(bad), PromptStructureError);
});

test("assertPromptStructurallySafe: rejects a prompt where style rules come before factual rules", () => {
  const bad = `REGLAS DE REDACCIÓN:
- Sé breve.

REGLAS FACTUALES:
1. No inventes nada.`;
  assert.throws(() => assertPromptStructurallySafe(bad), PromptStructureError);
});

test("assertPromptStructurallySafe: rejects a prompt missing either section header entirely", () => {
  assert.throws(() => assertPromptStructurallySafe("Solo un texto sin secciones."), PromptStructureError);
});
