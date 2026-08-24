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

// A token shaped like a citation: "Art. 29-A", "artículo 100", "CFDI40147", a
// catalog-code-looking or RMF-rule-looking dotted number (2.7.1.34 -- note the FIRST
// component is often single-digit, which the previous \d{2}\.\d\.\d\.\d+ grammar silently
// missed entirely: EVERY real RMF rule citation was invisible to Layer 1,
// hallucination-auditor finding #3). Deliberately broad on SHAPE; precision comes from
// the tolerant comparison below. False negatives here just mean Layer 1 lets something
// through for Layer 2 to catch semantically; false positives would reject well-formed
// prose for no reason.
const CITATION_LIKE_TOKEN =
  /\b(?:(?:art[ií]culo|art\.?)\s*\d+[A-Z\-]*|CFDI\s?\d{4,5}|\d{1,2}(?:\.\d+){2,4})\b/gi;

// Citation comparison is done on a normalized form: lowercased, accents stripped,
// whitespace collapsed. This is what lets a faithful paraphrase ("artículo 29-A")
// ground against the citation's own rendering ("Art. 29-A") instead of being rejected
// for spelling, while an INVENTED reference still fails because its number simply
// appears nowhere near any article word in satReference.
function normalizeForCitationCompare(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

/** The cores ("29-a") of every article-shaped citation actually present in the
 *  normalized satReference -- "Art. 29-A" contributes "29-a", so prose saying
 *  "artículo 29-A" (same core) passes while an invented "artículo 100" fails even if
 *  the bare number 100 happens to sit elsewhere in the citation text (a page number,
 *  say): the core only counts when an article word actually precedes it in
 *  satReference too. */
function collectArticleCores(normalizedSatReference: string): Set<string> {
  const cores = new Set<string>();
  const re = /(?:articulo|art\.?)\s*(\d+[a-z0-9-]*)/g;
  for (const m of normalizedSatReference.matchAll(re)) cores.add(m[1]);
  return cores;
}

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

// Consequence-overreach scan (hallucination-auditor finding #5): the recurring live
// failure was prose asserting a CONSEQUENCE ("el SAT lo rechazaría") that satReference
// never states -- invisible to the citation check above (no citation-shaped token) and
// to Layer 2 in practice (the claim rides along inside otherwise-faithful prose). Each
// entry pairs one consequence-shaped claim with the ONLY roots that ground it: if those
// roots appear nowhere in satReference, the claim is invented. Kept deliberately small
// and high-precision -- each pattern must be specific enough that ordinary faithful
// prose can't trip it by accident.
interface ConsequenceClaim {
  label: string;
  pattern: RegExp;
  groundingRoots: RegExp;
}

const CONSEQUENCE_CLAIMS: ConsequenceClaim[] = [
  {
    // "el SAT lo rechazaría", "el PAC la invalida"...
    label: "rechazo/invalidación por SAT o PAC",
    pattern: /(?:el\s+)?(?:sat|pac)\b[^.!?\n]{0,60}?(?:rechaz\w*|invalid\w*|anul\w*|no\s+aceptar[aí]\w*|desautoriz\w*)/gi,
    groundingRoots: /rechaz|invalid|anul|desautoriz|no aceptad|sin validez/i,
  },
  {
    // "sería rechazado", "va a ser invalidado"
    label: "consecuencia de rechazo condicionada",
    pattern: /(?:ser[íia]\s*(?:rechazad\w*|invalidad\w*|anulad\w*)|va[n]?\s+a\s+ser\s+(?:rechazad\w*|invalidad\w*))/gi,
    groundingRoots: /rechaz|invalid|anul|no producen ni produjeron|sin efecto/i,
  },
  {
    // "multas", "delito", "cárcel"...
    label: "sanción o consecuencia penal",
    pattern: /(sanci[oó]n(?:es)?\b|delito\b|c[aá]rcel\b|prisi[oó]n\b)/gi,
    groundingRoots: /sancion|delito|carcel|prision|pena/i,
  },
  {
    // "la deducción quedaría sin validez", "no sería deducible", "pierde el efecto fiscal"
    label: "pérdida de deducción o efecto fiscal",
    pattern: /(?:deducci[oó]n[^.!?\n]{0,50}(?:queda(?:r[íia])?\s*sin|se\s*pierde|(?:ser[íia]\s*)?inv[aá]lid\w*))|(?:pierde[ns]?\s+(?:el\s+)?efecto\s+fiscal)|no\s+(?:es|ser[íia]|ser[aá])\s+deducible/gi,
    groundingRoots: /efecto fiscal|deduc|no producen|inexistente/i,
  },
];

/** Layer 1 step: every consequence-shaped claim in the prose must have its grounding
 *  roots present in satReference; otherwise the prose asserts a legal/fiscal consequence
 *  the citation never states. Accent-insensitive on both sides via the same
 *  normalization the citation check uses. */
function verifyConsequenceFidelity(prose: string, satReference: string): VerifierResult {
  const normalizedProse = normalizeForCitationCompare(prose);
  const normalizedRef = normalizeForCitationCompare(satReference);
  for (const claim of CONSEQUENCE_CLAIMS) {
    const grounded = claim.groundingRoots.test(normalizedRef);
    if (grounded) continue;
    claim.pattern.lastIndex = 0;
    if (claim.pattern.test(normalizedProse)) {
      return {
        passed: false,
        layer: 1,
        reason: `afirmación de consecuencia no respaldada por satReference (${claim.label})`,
      };
    }
  }
  return { passed: true, layer: null, reason: null };
}

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

  // Catches an invented article number, RMF rule, or catalog code in free prose -- not
  // just an invented ruleId. Any citation-shaped token found in the explanation/
  // suggestion must be grounded in finding.satReference: either it survives
  // normalization as a substring there (verbatim modulo accents/case/spacing), or --
  // for article-word variants ("artículo" vs "Art.") -- its numeric core must be one
  // satReference itself presents after an article word. The old verbatim-substring-only
  // check both missed every lowercase/accented citation AND would have rejected a
  // faithful "artículo 29-A" paraphrase of "Art. 29-A"; hallucination-auditor #3.
  const prose = `${output.explicacion} ${output.sugerenciaCorreccion}`;
  const normalizedRef = normalizeForCitationCompare(finding.satReference);
  const refNoSpaces = normalizedRef.replace(/ /g, "");
  const articleCores = collectArticleCores(normalizedRef);

  const unsupported: string[] = [];
  for (const match of prose.matchAll(CITATION_LIKE_TOKEN)) {
    const token = match[0];
    const norm = normalizeForCitationCompare(token);
    if (refNoSpaces.includes(norm.replace(/ /g, ""))) continue;
    const articleCore = /(?:articulo|art\.?)\s*(\d+[a-z0-9-]*)/.exec(norm)?.[1];
    if (articleCore && articleCores.has(articleCore)) continue;
    unsupported.push(token);
  }
  if (unsupported.length > 0) {
    return {
      passed: false,
      layer: 1,
      reason: `citas no respaldadas por satReference: ${unsupported.join(", ")}`,
    };
  }

  // Catches a stated CONSEQUENCE (rejection, penalty, loss of deduction) that the
  // citation never mentions -- the "que el SAT rechazaría" class from
  // hallucination-auditor #5, which no other Layer 1 check can see.
  const consequence = verifyConsequenceFidelity(prose, finding.satReference);
  if (!consequence.passed) return consequence;

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
