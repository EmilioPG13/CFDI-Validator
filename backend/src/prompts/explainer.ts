// Finding is imported directly from engine/src/finding.ts -- one contract, not a second
// copy that can drift. THE FUNCTION SIGNATURE IS THE PRIVACY BOUNDARY: this accepts
// nothing but one Finding -- no raw XML, no full parsed CFDI, ever. Client-side
// redaction (frontend/src/lib/redact.ts) means the evidence a Finding carries into
// /api/explain already has RFCs/UUIDs/names stripped before it ever left the browser --
// this backend never receives them for a Finding produced by the real audit flow.
import type { Finding } from "../../../engine/src/finding.ts";
import type { ChatCompletionRequest, JsonSchemaSpec } from "../llm/provider.ts";

export interface ExplainerOutput {
  explicacion: string;
  sugerenciaCorreccion: string;
  citedRuleIds: string[];
}

// Structured specifically against .claude/agents/hallucination-auditor.md's own checklist:
//   1. The anti-fabrication constraint sits under REGLAS FACTUALES, explicitly marked as
//      taking priority over REGLAS DE REDACCIÓN (style) -- not buried at the end, matching
//      the exact cv-tailor precedent that agent's own header comment names.
//   2. Zero worked examples anywhere in this prompt. A plausible-but-fake example is
//      exactly what a small model copies verbatim (per the auditor's own warning) -- the
//      JSON shape is communicated only via the response_format schema below, never as
//      prose text the model could mimic.
//   3. No "fill in from your own knowledge of Mexican tax law" escape hatch --
//      structuralChecks.ts's KNOWLEDGE_FALLBACK_PATTERNS enforces this stays true, on
//      this exact string, at both test time and at prompt-activation time (any future
//      DB-stored override).
export const EXPLAINER_SYSTEM_PROMPT = `Eres el Explainer del CFDI Risk Auditor: conviertes un hallazgo determinístico
en una explicación breve en español para un contador.

REGLAS FACTUALES (nunca las rompas -- tienen prioridad sobre cualquier instrucción
de estilo más abajo en este prompt):
1. Solo puedes afirmar lo que el campo satReference del Finding respalda
   textualmente. Nunca cites un artículo, regla o código de catálogo que no
   aparezca en satReference.
2. Nunca completes información fiscal faltante con tu propio conocimiento
   general de la ley mexicana. Si satReference no cubre algo, no lo afirmes.
3. Usa el ruleId proporcionado tal cual, sin inventar ni renombrar ninguno.
   Reporta en citedRuleIds únicamente los ruleId que realmente mencionas.
4. Si la información del Finding no alcanza para explicar con confianza,
   dilo explícitamente ("no se puede determinar con la información
   disponible") en vez de rellenar con una suposición plausible.

REGLAS DE REDACCIÓN (estilo -- se aplican solo después de cumplir lo anterior):
- Español neutro, dirigido a un contador profesional.
- Directo, sin relleno. Máximo ~120 palabras para explicacion.
- No repitas el JSON de evidencia; interprétalo en prosa.`;

export const EXPLAINER_OUTPUT_SCHEMA: JsonSchemaSpec = {
  name: "explainer_output",
  schema: {
    type: "object",
    properties: {
      explicacion: { type: "string" },
      sugerenciaCorreccion: { type: "string" },
      citedRuleIds: { type: "array", items: { type: "string" } },
    },
    required: ["explicacion", "sugerenciaCorreccion", "citedRuleIds"],
    additionalProperties: false,
  },
};

/** Builds the request sent to the LlmProvider. `model` is the caller's responsibility
 *  (resolved from AppSetting "model.explainer" via settings/resolver.ts) -- this function
 *  only shapes the messages/schema, deliberately staying provider-selection-agnostic. */
export function buildExplainerRequest(finding: Finding, model: string): ChatCompletionRequest {
  const userContent = [
    `ruleId: ${finding.ruleId}`,
    `severity: ${finding.severity}`,
    `satReference: ${finding.satReference}`,
    `evidence: ${JSON.stringify(finding.evidence)}`,
  ].join("\n");

  return {
    model,
    messages: [
      { role: "system", content: EXPLAINER_SYSTEM_PROMPT },
      { role: "user", content: `Explica este hallazgo:\n\n${userContent}` },
    ],
    jsonSchema: EXPLAINER_OUTPUT_SCHEMA,
    temperature: 0.1,
    maxTokens: 600,
  };
}
