/**
 * The one contract every rule in the engine produces. Defined once here so
 * `cfdi-domain` specs, `rule-engine` implementations, and the eventual
 * Explainer/Verifier LLM layer all agree on the same shape — see
 * .claude/agents/rule-engine.md for the full rationale.
 */
export interface Finding {
  /** Matches a ruleId in engine/rules/registry.json exactly. */
  ruleId: string;
  /** XPath/dotted path to the offending node in the parsed CFDI. */
  fieldPath: string;
  severity: "error" | "warning";
  /** Copied verbatim from the rule spec's satReference — never paraphrased. */
  satReference: string;
  /** The actual offending value(s), for the Explainer to reference later. */
  evidence: unknown;
}
