import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogRow, SatCatalogs } from "../catalogs.ts";

// Verbatim from engine/rules/registry.json, ruleId "regimen-uso-compat" — do not
// paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "regimen-uso-compat";
const FIELD_PATH =
  "Comprobante/Receptor/@RegimenFiscalReceptor, validado contra Comprobante/Receptor/@UsoCFDI";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "phpcfdi/resources-sat-catalogs release v10.13.20260731, tabla cfdi_40_usos_cfdi, columna regimenes_fiscales_receptores (corpus/catalogs/catalogs.db). Esta columna es la representación en catálogo de la matriz de compatibilidad Régimen×Uso del Anexo 20 — el SAT publica los c_RegimenFiscal aceptados por cada c_UsoCFDI directamente en el catálogo, no solo en prosa.";

interface UsoCfdiRow extends CatalogRow {
  regimenes_fiscales_receptores: string;
}

/**
 * ruleId: regimen-uso-compat (engine/rules/registry.json).
 *
 * Comprobante/Receptor/@RegimenFiscalReceptor must appear in the whitelist the SAT
 * publishes per Comprobante/Receptor/@UsoCFDI (cfdi_40_usos_cfdi.regimenes_fiscales_receptores,
 * vigente as of Comprobante/@Fecha). If the UsoCFDI itself has no vigente catalog row for
 * that date, this rule has nothing to check against and stays silent — an unrecognized
 * UsoCFDI is a different rule's concern (and is already constrained by the CFDI 4.0 XSD's
 * catCFDI:c_UsoCFDI enumeration).
 */
export function regimenUsoCompat(parsed: ParsedCfdi, catalogs: SatCatalogs): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const usoCfdi = parsed.Receptor.UsoCFDI;
  const regimenReceptor = parsed.Receptor.RegimenFiscalReceptor;

  const usoRow = catalogs.findVigente<UsoCfdiRow>("cfdi_40_usos_cfdi", usoCfdi, asOfDate);
  if (!usoRow) {
    return [];
  }

  const regimenesValidos = usoRow.regimenes_fiscales_receptores
    .split(",")
    .map((code) => code.trim());

  if (regimenesValidos.includes(regimenReceptor)) {
    return [];
  }

  return [
    {
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: {
        RegimenFiscalReceptor: regimenReceptor,
        UsoCFDI: usoCfdi,
        regimenesValidos,
      },
    },
  ];
}
