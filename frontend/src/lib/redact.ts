// Client-side redaction, run BEFORE a Finding[] batch ever leaves the browser for
// POST /api/explain -- the backend never receives raw RFCs/UUIDs/names for a Finding
// produced by the real audit flow. This keeps the project's own privacy claim true
// ("client fiscal data never leaves the browser except the SAT lookup itself") rather
// than needing to be rewritten -- see CLAUDE.md's Phase 5 plan and the explicit decision
// to redact here, not server-side.
//
// Denylist derived by reading every rule's own evidence object under engine/src/rules/
// (not guessed): rfcEmisor, rfcReceptor, uuid, nombreContribuyente appear as identifying
// keys; `raw` carries the full SAT SOAP response (which itself echoes rfcEmisor/uuid)
// and is dropped entirely rather than picked apart field by field. Every other evidence
// key across all 13 rules is a numeric/arithmetic value (totals, tax amounts, catalog
// codes) or a non-identifying status enum -- not redacted, since the Explainer needs
// them to write a useful explanation and they carry no fiscal-identity risk on their own.
import type { Finding } from "../../../engine/src/finding.ts";

const REDACTED_KEYS = new Set(["rfcEmisor", "rfcReceptor", "uuid", "nombreContribuyente", "raw"]);
const REDACTED_PLACEHOLDER = "[redactado]";

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key) ? REDACTED_PLACEHOLDER : redactValue(v);
    }
    return out;
  }
  return value;
}

/** The one function every caller of /api/explain must run each Finding through first.
 *  fieldPath/ruleId/severity/satReference are never redacted -- they're rule metadata,
 *  not fiscal identifiers about a specific taxpayer. Only `evidence` can carry an RFC/
 *  UUID/name, since it's the one field whose shape varies per rule. */
export function redactFindingForExplainer(finding: Finding): Finding {
  return { ...finding, evidence: redactValue(finding.evidence) };
}

export function redactFindingsForExplainer(findings: Finding[]): Finding[] {
  return findings.map(redactFindingForExplainer);
}
