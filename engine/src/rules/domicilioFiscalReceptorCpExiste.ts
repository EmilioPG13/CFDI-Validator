import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogSource } from "../catalogTypes.ts";

// Verbatim from engine/rules/registry.json, ruleId "domicilio-fiscal-receptor-cp-existe" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "domicilio-fiscal-receptor-cp-existe";
const FIELD_PATH = "Comprobante/Receptor/@DomicilioFiscalReceptor";
const SEVERITY: Finding["severity"] = "warning";
const SAT_REFERENCE =
  "corpus/catalogs/catalogs.db, tabla cfdi_40_codigos_postales (95,748 filas) — catálogo oficial de códigos postales del SAT.";

/**
 * ruleId: domicilio-fiscal-receptor-cp-existe (engine/rules/registry.json).
 *
 * Comprobante/Receptor/@DomicilioFiscalReceptor must exist as a vigente row (as of
 * Comprobante/@Fecha) in cfdi_40_codigos_postales.
 *
 * Scope limitation (see the "notes" field of this ruleId in registry.json): this only
 * confirms the CP is a real, currently-valid Mexican postal code — it does NOT confirm
 * it's the CP actually registered to this Receptor's RFC per their Constancia de
 * Situación Fiscal, which is what the SAT's real CFDI40147/CFDI40148 rejections check
 * and which isn't derivable from any public, credential-free data source. That's why
 * this is severity "warning", not "error".
 */
export function domicilioFiscalReceptorCpExiste(
  parsed: ParsedCfdi,
  catalogs: CatalogSource,
): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const cp = parsed.Receptor.DomicilioFiscalReceptor;

  const cpRow = catalogs.findVigente("cfdi_40_codigos_postales", cp, asOfDate);
  if (cpRow) {
    return [];
  }

  return [
    {
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: { DomicilioFiscalReceptor: cp },
    },
  ];
}
