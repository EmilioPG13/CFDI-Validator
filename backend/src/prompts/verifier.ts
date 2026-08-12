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

// Captures a MAXIMAL run of letters/digits/comma/period as one token -- "G03", "605,",
// "900.00", "CFDI" are each one match. Deliberately does NOT decide here whether a token
// is a number; PURE_NUMBER below does that as a separate filter step on the whole token.
//
// This two-step shape (capture the whole alnum run, THEN classify it) replaced a
// single-regex `(?<!\p{L})\d[\d,]*(?:\.\d+)?` approach that looked right but wasn't, caught
// live against a real production sample (2026-08-11, running this exact check end-to-end
// against 6/6 real Explainer outputs, not just unit tests -- every one false-positive-
// rejected). The bug: a negative lookbehind only blocks a match from STARTING right after a
// letter -- it does nothing to stop the regex engine from retrying a match starting at the
// SECOND digit of the same run once the first attempt fails. In "G03", the attempt starting
// at "0" is correctly blocked (preceded by the letter "G"), but the very next attempt
// starts at "3" -- preceded by "0", a digit, not a letter -- so the lookbehind has nothing
// to say about it, and "3" matches as if it were a standalone number. Capturing the whole
// "G03" run first and only THEN checking whether the entire token is purely numeric closes
// this for good: "G03" contains a letter, so it's excluded in one piece, not eligible to be
// partially matched at all.
const VALUE_TOKEN = /[\p{L}\p{N}][\p{L}\p{N},.]*/gu;
// A token is a "claimed number" only if EVERY character in it is a digit, comma, or
// decimal point -- one leading letter anywhere (a catalog code, a citation fragment)
// disqualifies the whole token from this check, rather than salvaging whatever digits
// happen to be in it.
const PURE_NUMBER = /^\d[\d,]*(?:\.\d+)?$/;

function parseNumberToken(token: string): number {
  return Number(token.replace(/,/g, ""));
}

/** Every token in `text` that is a pure number (see PURE_NUMBER) -- excludes alphanumeric
 *  codes like "G03" or "CFDI40205" entirely, not just their leading digit.
 *
 *  Trailing sentence punctuation is stripped before classifying, not after: VALUE_TOKEN's
 *  char class includes "," and "." (needed mid-token, for "1,000.00") so it also greedily
 *  swallows whatever comma or period immediately follows a number in real prose ("...es
 *  800." / "...declara 950.00, pero..."). Caught live, same production sample as the
 *  VALUE_TOKEN fix above: PURE_NUMBER's grammar only allows a trailing decimal SECTION,
 *  not a bare comma/period after it, so an untrimmed "950.00," silently failed
 *  PURE_NUMBER and got dropped from the check entirely -- not flagged, not verified, just
 *  invisible. That's the opposite failure mode from the "3" bug (a false negative instead
 *  of a false positive) but the same root cause: classifying before isolating the number
 *  cleanly. */
function extractPureNumberTokens(text: string): string[] {
  const tokens = text.match(VALUE_TOKEN) ?? [];
  const numbers: string[] = [];
  for (const token of tokens) {
    const trimmed = token.replace(/[.,]+$/, "");
    if (PURE_NUMBER.test(trimmed)) numbers.push(trimmed);
  }
  return numbers;
}

// satReference almost always glues a version number directly to a single lowercase "v"
// with no space -- "CFDI v4.0" -- because that's the literal Anexo 20 title text. The
// Explainer's own paraphrase just as often renders the identical fact WITH a space
// ("CFDI 4.0"), which is a completely faithful restatement, not an invented number. Caught
// live (2026-08-11, same real production sample as the two fixes above): treating only
// strictly-pure-numeric tokens as "grounded" means "v4.0" contributes nothing to the known
// set (it starts with a letter), so the paraphrase's bare "4.0" gets rejected as
// unsupported even though it's the exact same fact, just reformatted -- a real, recurring
// false positive, not a hypothetical one, since nearly every Anexo-20-sourced satReference
// in this codebase starts with this exact phrase.
const LETTER_PREFIXED_NUMBER = /^\p{L}(\d[\d,]*(?:\.\d+)?)$/u;

/** Everything extractPureNumberTokens finds, PLUS a number glued to exactly one leading
 *  letter ("v4.0" -> "4.0"). Used ONLY to build the set of numbers a Finding's satReference
 *  grounds -- deliberately NOT used on the Explainer's own prose, so this stays a one-way
 *  relaxation: it lets more things count as "already said by the citation," it does not
 *  loosen what counts as a "number the prose claims" in the first place. */
function extractGroundedNumberTokens(text: string): string[] {
  const tokens = text.match(VALUE_TOKEN) ?? [];
  const numbers: string[] = [];
  for (const token of tokens) {
    const trimmed = token.replace(/[.,]+$/, "");
    if (PURE_NUMBER.test(trimmed)) {
      numbers.push(trimmed);
      continue;
    }
    const letterPrefixed = LETTER_PREFIXED_NUMBER.exec(trimmed);
    if (letterPrefixed) numbers.push(letterPrefixed[1]);
  }
  return numbers;
}

/** Flattens every number (or numeric-looking string) reachable in a Finding's evidence
 *  into a Set of parsed floats -- rule functions (engine/src/rules/*.ts) always
 *  pre-compute whatever sum/value the prose needs to state, so this is the complete set
 *  of numbers the Explainer legitimately had available. */
function collectEvidenceNumbers(evidence: unknown, into: Set<number>): void {
  if (typeof evidence === "number" && Number.isFinite(evidence)) {
    into.add(evidence);
  } else if (typeof evidence === "string" && evidence.trim() !== "") {
    const parsed = Number(evidence);
    if (Number.isFinite(parsed)) into.add(parsed);
  } else if (Array.isArray(evidence)) {
    for (const item of evidence) collectEvidenceNumbers(item, into);
  } else if (evidence !== null && typeof evidence === "object") {
    for (const value of Object.values(evidence)) collectEvidenceNumbers(value, into);
  }
}

/** The full set of numbers a Finding actually grounds: everything in `evidence` (the
 *  values the rule engine computed) plus every bare number appearing in `satReference`
 *  itself (page numbers, code fragments, etc. that a faithful paraphrase of the citation
 *  text might legitimately restate) -- NOT general knowledge, only what this Finding
 *  carries. */
function collectFindingNumbers(finding: Finding): Set<number> {
  const numbers = new Set<number>();
  collectEvidenceNumbers(finding.evidence, numbers);
  for (const token of extractGroundedNumberTokens(finding.satReference)) {
    numbers.add(parseNumberToken(token));
  }
  return numbers;
}

const NUMBER_TOLERANCE = 0.005;

/** No model call, same as the citation check above. Closes the one class of claim neither
 *  this file's own citation check nor Layer 2's LLM prompt ever inspected (2026-08-10
 *  hallucination-auditor finding #1): buildVerifierRequest never sends `evidence` to the
 *  model, so nothing anywhere checked whether a NUMBER the prose states (a declared total,
 *  a catalog code) actually matches the Finding's real evidence, as opposed to merely
 *  citing a real ruleId/article. Known limitation, accepted rather than silently
 *  unhandled: a paraphrase that states a DERIVED number not literally present (e.g. "hay
 *  11 regímenes válidos" for an 11-item array) will be rejected as unsupported even though
 *  it's arithmetically correct -- consistent with this Verifier's documented fail-closed
 *  stance (see this file's header comment) and with the Explainer prompt's own "no
 *  repitas el JSON de evidencia; interprétalo en prosa" instruction not license to
 *  introduce a number that isn't there. */
function verifyEvidenceFidelity(finding: Finding, output: ExplainerOutput): VerifierResult {
  const known = collectFindingNumbers(finding);
  const prose = `${output.explicacion} ${output.sugerenciaCorreccion}`.replace(CITATION_LIKE_TOKEN, " ");
  const proseTokens = extractPureNumberTokens(prose);

  const invented = new Set<string>();
  for (const token of proseTokens) {
    const parsed = parseNumberToken(token);
    let supported = false;
    for (const value of known) {
      if (Math.abs(value - parsed) < NUMBER_TOLERANCE) {
        supported = true;
        break;
      }
    }
    if (!supported) invented.add(token);
  }

  if (invented.size > 0) {
    return {
      passed: false,
      layer: 1,
      reason: `número(s) en la explicación no respaldados por evidence/satReference: ${[...invented].join(", ")}`,
    };
  }
  return { passed: true, layer: null, reason: null };
}

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

  // Catches an invented NUMBER in free prose -- a declared total, a catalog code -- that
  // the citation check above can't see because it only looks at citation-SHAPED tokens.
  const fidelity = verifyEvidenceFidelity(finding, output);
  if (!fidelity.passed) return fidelity;

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

// `systemPrompt` defaults to the in-code fallback -- same reasoning as
// explainer.ts's buildExplainerRequest: stays a plain string param (synchronous, DB-free)
// so verifier.test.ts keeps asserting against VERIFIER_SYSTEM_PROMPT directly; the DB
// resolution (prompts/store.ts's resolveActivePromptBody, Sub-phase 5e) happens in
// jobs/processor.ts, not here.
export function buildVerifierRequest(
  finding: Finding,
  output: ExplainerOutput,
  model: string,
  systemPrompt: string = VERIFIER_SYSTEM_PROMPT,
): ChatCompletionRequest {
  const userContent = [
    `satReference: ${finding.satReference}`,
    `explicacion generada: ${output.explicacion}`,
    `sugerenciaCorreccion generada: ${output.sugerenciaCorreccion}`,
  ].join("\n");

  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
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
  systemPrompt: string = VERIFIER_SYSTEM_PROMPT,
): Promise<VerifierResult> {
  const result = await provider.chatCompletion(buildVerifierRequest(finding, output, model, systemPrompt));
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
