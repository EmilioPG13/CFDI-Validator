// Two layers, second only runs if the first passes -- no point burning a rate-limited,
// cost-bearing LLM call verifying output that's already been deterministically rejected.
//
// Deliberate difference from .claude/agents/hallucination-auditor.md itself: that
// dev-time subagent treats its semantic layer as judgment-based ("flag, don't
// auto-resolve") because a human reads its output before acting. This RUNTIME Verifier
// auto-rejects on both layers -- there is no human in the loop per-explanation, so it
// must fail closed. Not an inconsistency; the dev-time and runtime versions have
// different consumers, per the Phase 5 plan's own explicit note on this.
import type { Finding } from "../../../engine/src/finding.ts";
import type { ChatCompletionRequest, JsonSchemaSpec, LlmProvider } from "../llm/provider.ts";
import { getKnownRuleIds } from "../llm/ruleCatalog.ts";
import type { ExplainerOutput } from "./explainer.ts";

export interface VerifierResult {
  passed: boolean;
  layer: 1 | 2 | null;
  reason: string | null;
}

// A token shaped like a citation: "Art. 29-A", "CFDI40147", a catalog-code-looking
// pattern (NN.N.N.NNNN). Deliberately conservative (may miss some real citations) --
// false negatives here just mean Layer 1 lets something through for Layer 2 to catch
// semantically; false positives would reject well-formed prose for no reason.
const CITATION_LIKE_TOKEN = /\b(Art\.?\s*\d+[A-Z\-]*|CFDI\d{5}|\d{2}\.\d\.\d\.\d+)\b/g;

/** No model call. Auto-reject on failure -- reuses the actual rule registry
 *  (llm/ruleCatalog.ts), never a hand-typed list that could drift from it. */
export function verifyLayer1(finding: Finding, output: ExplainerOutput): VerifierResult {
  const known = getKnownRuleIds();
  const unknownCited = output.citedRuleIds.filter((id) => !known.has(id));
  if (unknownCited.length > 0) {
    return {
      passed: false,
      layer: 1,
      reason: `ruleId(s) citados no existen en el catálogo: ${unknownCited.join(", ")}`,
    };
  }

  // Catches an invented article number or catalog code in free prose -- not just an
  // invented ruleId. Any citation-shaped token found in the explanation/suggestion must
  // be a verbatim substring of finding.satReference; nothing invented, nothing paraphrased.
  const prose = `${output.explicacion} ${output.sugerenciaCorreccion}`;
  const citationLike = prose.match(CITATION_LIKE_TOKEN) ?? [];
  const unsupported = citationLike.filter((c) => !finding.satReference.includes(c));
  if (unsupported.length > 0) {
    return {
      passed: false,
      layer: 1,
      reason: `citas no respaldadas por satReference: ${unsupported.join(", ")}`,
    };
  }

  return { passed: true, layer: null, reason: null };
}

export interface Layer2Output {
  overstates: boolean;
  reasoning: string;
}

export const VERIFIER_SYSTEM_PROMPT = `Eres el Verifier del CFDI Risk Auditor. Se te da un Finding y una explicación ya
generada. Tu único trabajo es responder si la prosa exagera o tergiversa lo que
satReference realmente dice -- no reescribas la explicación, no la completes.

REGLAS FACTUALES:
1. Compara únicamente contra el texto de satReference proporcionado. No uses
   tu propio conocimiento de la ley para juzgar si algo es "correcto" en general.
2. overstates: true significa que la prosa afirma algo más fuerte, más
   específico, o distinto de lo que satReference respalda -- no que esté
   "mal redactado".

REGLAS DE REDACCIÓN:
- Responde solo con el JSON solicitado, sin explicación adicional fuera del campo reasoning.`;

export const VERIFIER_OUTPUT_SCHEMA: JsonSchemaSpec = {
  name: "verifier_output",
  schema: {
    type: "object",
    properties: {
      overstates: { type: "boolean" },
      reasoning: { type: "string" },
    },
    required: ["overstates", "reasoning"],
    additionalProperties: false,
  },
};

export function buildVerifierRequest(finding: Finding, output: ExplainerOutput, model: string): ChatCompletionRequest {
  const userContent = [
    `satReference: ${finding.satReference}`,
    `explicacion generada: ${output.explicacion}`,
    `sugerenciaCorreccion generada: ${output.sugerenciaCorreccion}`,
  ].join("\n");

  return {
    model,
    messages: [
      { role: "system", content: VERIFIER_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    jsonSchema: VERIFIER_OUTPUT_SCHEMA,
    temperature: 0.1,
    maxTokens: 300,
  };
}

/** Runs Layer 2 only if Layer 1 already passed -- called by jobs/processor.ts. */
export async function verifyLayer2(
  provider: LlmProvider,
  finding: Finding,
  output: ExplainerOutput,
  model: string,
): Promise<VerifierResult> {
  const result = await provider.chatCompletion(buildVerifierRequest(finding, output, model));
  const data = result.data as Layer2Output | null;
  if (!data) {
    return { passed: false, layer: 2, reason: "Verifier no devolvió JSON válido." };
  }
  if (data.overstates) {
    return { passed: false, layer: 2, reason: data.reasoning };
  }
  return { passed: true, layer: null, reason: null };
}

// --- Different-model-family enforcement -------------------------------------------------

/** The org prefix before the "/" in a NIM model id, e.g. "meta/llama-3.1-8b-instruct" ->
 *  "meta". Falls back to the whole id if there's no "/" (defensive -- shouldn't happen
 *  for a real NIM catalog entry, but a malformed id must not crash the comparison). */
export function getModelFamily(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash === -1 ? modelId : modelId.slice(0, slash);
}

export class SameModelFamilyError extends Error {
  constructor(explainerModel: string, verifierModel: string) {
    super(
      `Explainer ("${explainerModel}") and Verifier ("${verifierModel}") must be from ` +
        `different model families (both are "${getModelFamily(explainerModel)}") -- a ` +
        "model does not reliably catch its own errors.",
    );
    this.name = "SameModelFamilyError";
  }
}

/** Called from routes/admin/settings.ts before writing model.explainer or
 *  model.verifier -- an enforced constraint, not a UI suggestion. */
export function assertDifferentModelFamily(explainerModel: string, verifierModel: string): void {
  if (getModelFamily(explainerModel) === getModelFamily(verifierModel)) {
    throw new SameModelFamilyError(explainerModel, verifierModel);
  }
}
