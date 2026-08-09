// Shared by explainerPrompt.test.ts (asserted against the in-code fallback prompts) AND
// routes/admin/prompts.ts's POST /:id/activate (asserted against any admin-submitted
// prompt body). One set of rules, two enforcement points -- this is what actually closes
// cv-tailor's own regression-test gap (its tailorPrompt.test.js can only ever see the
// in-code FALLBACK_SETTINGS, never whatever an admin has stored in app_settings at
// runtime) instead of just documenting around it the way cv-tailor's own README does.
//
// Technique adapted directly from cv-tailor/server/routes/tailorPrompt.test.js (read this
// session): assert a forbidden phrase is ABSENT, assert the required constraint is
// PRESENT, and -- the rigorous part -- assert the constraint's string position falls
// inside the factual-rules section via indexOf bounds, not just "exists somewhere."

const FACTUAL_HEADER = "REGLAS FACTUALES";
const STYLE_HEADER = "REGLAS DE REDACCIÓN";

// Phrases that would silently license the exact failure mode this whole layer exists to
// prevent: filling a fiscal gap from the model's own general knowledge instead of only
// what the Finding's satReference actually supports.
const KNOWLEDGE_FALLBACK_PATTERNS: RegExp[] = [
  /tu conocimiento/i,
  /usa tu conocimiento de la ley/i,
  /en caso de no contar con.*informaci[oó]n.*usa/i,
  /completa con lo que sepas/i,
];

export class PromptStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptStructureError";
  }
}

/** Throws PromptStructureError with a specific, admin-facing reason on the first
 *  violation found. Never returns a boolean -- a caller that ignores a boolean is
 *  exactly the failure mode this function exists to prevent. */
export function assertPromptStructurallySafe(body: string): void {
  for (const pattern of KNOWLEDGE_FALLBACK_PATTERNS) {
    if (pattern.test(body)) {
      throw new PromptStructureError(
        `Prompt contains a knowledge-fallback escape hatch (matched ${pattern}) -- this ` +
          "would let the model fill a fiscal gap from its own general knowledge instead " +
          "of only what a Finding's satReference actually supports.",
      );
    }
  }

  const factualIdx = body.indexOf(FACTUAL_HEADER);
  const styleIdx = body.indexOf(STYLE_HEADER);
  if (factualIdx === -1) {
    throw new PromptStructureError(`Prompt is missing the "${FACTUAL_HEADER}" section header.`);
  }
  if (styleIdx === -1) {
    throw new PromptStructureError(`Prompt is missing the "${STYLE_HEADER}" section header.`);
  }
  if (factualIdx > styleIdx) {
    throw new PromptStructureError(
      `"${FACTUAL_HEADER}" must appear before "${STYLE_HEADER}" -- factual/anti-fabrication ` +
        "rules take priority over style guidance and must not be positioned after it.",
    );
  }
}

/** Used by both the test suite and assertPromptStructurallySafe's own bounds logic to
 *  locate a specific required clause and confirm it falls inside the factual section
 *  (between FACTUAL_HEADER and STYLE_HEADER), not merely "exists somewhere in the prompt."
 *  Throws PromptStructureError if the clause is absent or misplaced. */
export function assertClauseInFactualSection(body: string, clausePattern: RegExp, clauseLabel: string): void {
  const factualIdx = body.indexOf(FACTUAL_HEADER);
  const styleIdx = body.indexOf(STYLE_HEADER);
  const match = clausePattern.exec(body);
  if (!match) {
    throw new PromptStructureError(`Required clause "${clauseLabel}" is missing from the prompt.`);
  }
  const clauseIdx = match.index;
  if (factualIdx === -1 || styleIdx === -1 || !(clauseIdx > factualIdx && clauseIdx < styleIdx)) {
    throw new PromptStructureError(
      `Required clause "${clauseLabel}" must be positioned between "${FACTUAL_HEADER}" and ` +
        `"${STYLE_HEADER}", not elsewhere in the prompt.`,
    );
  }
}
