// Reads engine/rules/registry.json directly -- the actual source of truth for which
// ruleIds exist, never re-implemented as a hand-typed list. This is the allowlist the
// Verifier's deterministic Layer 1 (prompts/verifier.ts) checks every citedRuleId
// against: a fabricated ruleId in an Explainer's output must be auto-rejected, and the
// only way to know "fabricated" is to check against the same registry the rule engine
// itself is built from.
import { readFileSync } from "node:fs";
import path from "node:path";

interface RuleRegistryEntry {
  ruleId: string;
  satReference: string;
  [key: string]: unknown;
}

interface RuleRegistry {
  rules: RuleRegistryEntry[];
}

const REGISTRY_PATH = path.resolve(import.meta.dirname, "../../../engine/rules/registry.json");

let cachedRuleIds: Set<string> | null = null;
let cachedSatReferences: Map<string, string> | null = null;

function load(): { ids: Set<string>; references: Map<string, string> } {
  if (cachedRuleIds && cachedSatReferences) {
    return { ids: cachedRuleIds, references: cachedSatReferences };
  }
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  const registry = JSON.parse(raw) as RuleRegistry;
  cachedRuleIds = new Set(registry.rules.map((r) => r.ruleId));
  cachedSatReferences = new Map(registry.rules.map((r) => [r.ruleId, r.satReference]));
  return { ids: cachedRuleIds, references: cachedSatReferences };
}

/** The Set every citedRuleId in an Explainer/Verifier output must be checked against. */
export function getKnownRuleIds(): Set<string> {
  return load().ids;
}

/** The registry's own satReference for a ruleId, if it exists -- used by verifyLayer1
 *  (prompts/verifier.ts) to double check a Finding's own satReference wasn't tampered
 *  with client-side before it ever reached this backend. Returns undefined for an
 *  unknown ruleId (the caller should already have rejected on getKnownRuleIds()). */
export function getRegistrySatReference(ruleId: string): string | undefined {
  return load().references.get(ruleId);
}

/** Test-only: forces a re-read on the next call. Production code never needs this --
 *  registry.json doesn't change during a process's lifetime. */
export function resetRuleCatalogCache(): void {
  cachedRuleIds = null;
  cachedSatReferences = null;
}
