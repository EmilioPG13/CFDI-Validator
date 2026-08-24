// LLM narration of the deterministic diff -- the ONLY place this package uses a model,
// and deliberately not a source of truth: the diff itself is computed by catalogDiff /
// efosWatch / xsdWatch, the model only words it. Two layers guard that claim:
//
//   Layer 1 (deterministic, always runs): every number-shaped or citation-shaped token
//   in the narration must literally appear in the facts JSON the model was given. A
//   number the data doesn't contain cannot be stated -- fail closed, same stance as the
//   runtime Verifier (backend/src/prompts/verifier.ts).
//
//   Layer 2 (prompt-level): the system prompt forbids citing articles/rules, asserting
//   causes or legal consequences, and using knowledge beyond the data -- structured to
//   put factual rules before style rules, per .claude/agents/hallucination-auditor.md.
//
// On grounding failure: one corrective retry, then the PR ships WITHOUT a narration
// section (explicitly marked) rather than with an unverified one.

// Same token-extraction approach as backend/src/prompts/verifier.ts (capture the whole
// alphanumeric run, THEN classify it) -- including its two live-caught lessons: classify
// only after stripping trailing punctuation, and never salvage digits out of mixed
// tokens like "G03". Copied rather than imported because this package runs standalone
// in CI without backend/'s dependency tree.
const VALUE_TOKEN = /[\p{L}\p{N}][\p{L}\p{N},.]*/gu;
const PURE_NUMBER = /^\d[\d,]*(?:\.\d+)?$/;
// Anything article-/rule-/code-shaped is forbidden outright in narration (see Layer 2),
// so every citation-shaped token found is an automatic rejection -- there is no
// "supported citation" case to check against here.
const CITATION_LIKE_TOKEN = /\b(art[ií]culo\s+\d+[A-Z\-]*|art\.?\s*\d+[A-Z\-]*|CFDI\d{4,5}|\d{1,2}(?:\.\d+){2,4})\b/gi;

function extractNumberTokens(text: string): string[] {
  const tokens = text.match(VALUE_TOKEN) ?? [];
  const numbers: string[] = [];
  for (const token of tokens) {
    const trimmed = token.replace(/[.,]+$/, "");
    if (PURE_NUMBER.test(trimmed)) numbers.push(trimmed);
  }
  return numbers;
}

// Catalog codes (MXN, G03), release tags (v9.51.20260312), RFCs and table ids are either
// ALL-UPPERCASE or letter+digit mixes; normal Spanish prose is neither (sentence-initial
// capitals still contain lowercase letters). So code-like tokens are held to the same
// standard as numbers: they must come from the data. Generic acronyms that can
// legitimately appear in prose without being data are the only exceptions -- kept
// minimal and explicit so this can't quietly grow into a loophole.
const CODE_LIKE_TOKEN_ALLOWLIST = new Set(["sat", "ia", "xsd", "datos", "cfdi"]);

/** Catalog-code-shaped claims: all-uppercase tokens, or tokens mixing letters and digits. */
function extractCodeLikeTokens(text: string): string[] {
  const tokens = text.match(VALUE_TOKEN) ?? [];
  const out: string[] = [];
  for (const raw of tokens) {
    const trimmed = raw.replace(/[.,]+$/, "");
    if (PURE_NUMBER.test(trimmed)) continue;
    if (!/\p{L}/u.test(trimmed)) continue;
    const allUpper = trimmed.length >= 2 && trimmed === trimmed.toUpperCase() && /\p{Lu}/u.test(trimmed);
    const letterDigitMix = /\p{L}/u.test(trimmed) && /\p{N}/u.test(trimmed);
    if ((allUpper || letterDigitMix) && !CODE_LIKE_TOKEN_ALLOWLIST.has(trimmed.toLowerCase())) {
      out.push(trimmed);
    }
  }
  return out;
}

/** Everything the narration may legitimately say, token-wise: every alphanumeric run in
 *  the facts payload (row ids, catalog codes, release tags, ISO dates) plus its bare
 *  numbers. Built from exactly the JSON string the model received -- not from the raw
 *  diff -- so "it was in the data somewhere" and "the model saw it" are the same set. */
export function buildGroundingSet(factsJson: string): Set<string> {
  const grounded = new Set<string>();
  const push = (t: string) => grounded.add(t);
  for (const token of factsJson.match(VALUE_TOKEN) ?? []) {
    push(token);
    const trimmed = token.replace(/[.,]+$/, "");
    if (PURE_NUMBER.test(trimmed)) push(trimmed);
  }
  return grounded;
}

export function verifyNarrationGrounding(
  resumen: string,
  grounded: Set<string>,
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  const citationMatches = [...resumen.matchAll(CITATION_LIKE_TOKEN)].map((m) => m[0]);
  violations.push(...citationMatches.map((c) => `cita prohibida en narración: "${c}"`));

  for (const num of extractNumberTokens(resumen)) {
    if (!grounded.has(num)) violations.push(`número no presente en los datos: "${num}"`);
  }
  for (const code of extractCodeLikeTokens(resumen)) {
    if (!grounded.has(code)) violations.push(`código/identificador no presente en los datos: "${code}"`);
  }
  return { passed: violations.length === 0, violations };
}

// --- Facts payload -----------------------------------------------------------------------

export interface NarrationFacts {
  fuentes_cambiadas?: string[];
  catalogs?: Record<string, unknown>;
  efos?: Record<string, unknown>;
  xsd?: Record<string, unknown>;
  anexo20?: Record<string, unknown>;
}

/** Serializes the facts payload exactly as the model will see it -- the grounding set
 *  MUST be built from this same string, so "in the data" and "the model saw it" can
 *  never diverge. Sampling/bounding of big diffs happens when building the NarrationFacts
 *  object itself (see cli.ts), not here. */
export function buildFactsJson(facts: NarrationFacts): string {
  return JSON.stringify(facts, null, 0);
}

// --- NIM call -----------------------------------------------------------------------------

export const NARRATOR_SYSTEM_PROMPT = `Eres el Catalog Watcher del CFDI Risk Auditor. Recibes un diff determinístico entre
dos versiones de los datos públicos del SAT que este sistema usa como fuente de verdad
(catálogos CFDI 4.0, esquemas XSD, guía Anexo 20, listado 69-B). Tu único trabajo es
redactar un resumen breve en español de ESE diff, para que un revisor humano decida si
acepta el cambio.

REGLAS FACTUALES (nunca las rompas -- tienen prioridad sobre cualquier instrucción de
estilo más abajo en este prompt):
1. Solo puedes afirmar lo que aparezca literalmente en el campo DATOS. Cada número,
   código, fecha o identificador de tu resumen debe estar copiado tal cual de DATOS.
2. Nunca afirmes POR QUÉ el SAT hizo un cambio, ni qué consecuencias legales o
   fiscales tiene, ni nada que no esté explícitamente en DATOS. No interpretes.
3. Nunca cites artículos, reglas del Anexo 20 ni códigos de rechazo -- ese trabajo lo
   hacen las reglas del motor, no el resumen del diff.
4. Si DATOS no alcanza para describir algo, omítelo; nunca lo completes con tu propio
   conocimiento.

REGLAS DE REDACCIÓN (estilo -- se aplican solo después de cumplir lo anterior):
- Español neutro, máximo ~150 palabras, viñetas markdown.
- Empieza cada fuente cambiada con su nombre (Catálogos / XSD / Anexo 20 / Listado 69-B).
- No repitas estructuras JSON completas; usa conteos y ejemplos.`;

const NARRATION_SCHEMA = {
  name: "catalog_watcher_narration",
  schema: {
    type: "object",
    properties: {
      resumen: { type: "string" },
    },
    required: ["resumen"],
    additionalProperties: false,
  },
};

async function nimChat(args: {
  apiKey: string;
  baseUrl: string;
  model: string;
  userContent: string;
}): Promise<string> {
  const res = await fetch(`${args.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    // 167s for a trivial call is normal on NIM's free tier (measured, see
    // backend/src/llm/nimProvider.ts) -- timeout accordingly, don't treat slow as dead.
    signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: NARRATOR_SYSTEM_PROMPT },
        { role: "user", content: args.userContent },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: "json_schema", json_schema: NARRATION_SCHEMA },
    }),
  });
  if (!res.ok) {
    throw new Error(`NIM chat completion failed: HTTP ${res.status} -- ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function parseNarration(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { resumen?: unknown };
    if (typeof parsed.resumen === "string") return parsed.resumen;
  } catch {
    // fall through: some models wrap JSON in fences even in schema mode
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(content.slice(start, end + 1)) as { resumen?: unknown };
      if (typeof parsed.resumen === "string") return parsed.resumen;
    } catch {
      /* give up below */
    }
  }
  return null;
}

export interface NarrationResult {
  resumen: string | null;
  attempts: { grounded: boolean; violations: string[] }[];
}

/** One call + grounding check + one corrective retry. Returns null resumen when the
 *  model can't produce a fully-grounded summary in two attempts -- callers ship the PR
 *  without narration instead of with an unverifiable one. */
export async function narrateDiff(args: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  facts: NarrationFacts;
}): Promise<NarrationResult> {
  const factsJson = buildFactsJson(args.facts);
  const grounded = buildGroundingSet(factsJson);
  const userContent = `DATOS (diff determinístico, única fuente permitida):\n${factsJson}`;

  const attempts: NarrationResult["attempts"] = [];
  let userMsg = userContent;
  for (let i = 0; i < 2; i++) {
    const content = await nimChat({
      apiKey: args.apiKey,
      baseUrl: args.baseUrl ?? "https://integrate.api.nvidia.com/v1",
      model: args.model,
      userContent: userMsg,
    });
    const resumen = parseNarration(content);
    if (resumen === null) {
      attempts.push({ grounded: false, violations: ["respuesta no es JSON con campo resumen"] });
      continue;
    }
    const verdict = verifyNarrationGrounding(resumen, grounded);
    attempts.push({ grounded: verdict.passed, violations: verdict.violations });
    if (verdict.passed) return { resumen, attempts };
    userMsg =
      `${userContent}\n\nTu resumen anterior fue RECHAZADO por incluir información no presente en ` +
      `DATOS: ${verdict.violations.join("; ")}. Reescribe usando ÚNICAMENTE números, códigos y fechas ` +
      "copiados textualmente de DATOS.";
  }
  return { resumen: null, attempts };
}
