import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogSource } from "../catalogTypes.ts";

// Verbatim from engine/rules/registry.json, ruleId "claveprodserv-claveunidad-vigente" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "claveprodserv-claveunidad-vigente";
const SEVERITY: Finding["severity"] = "warning";
const SAT_REFERENCE =
  "corpus/catalogs/catalogs.db, tabla cfdi_40_productos_servicios (52,513 filas) y tabla cfdi_40_claves_unidades (2,418 filas) — catálogos oficiales de Productos y Servicios y de Claves de Unidad del SAT, ambos con columnas vigencia_desde/vigencia_hasta.";

// The registry.json fieldPath for this ruleId ("Comprobante/Conceptos/Concepto/@ClaveProdServ
// y Comprobante/Conceptos/Concepto/@ClaveUnidad") describes both checks together as a
// single spec entry. Per-Finding, each check points at its own specific attribute — the
// spec's condition text asks for "fieldPath apuntando a este Concepto específico" with
// conceptoIndex carried in evidence to disambiguate findings across multiple Conceptos
// (see this rule's condition steps 2a/2b in registry.json).
const FIELD_PATH_CLAVE_PROD_SERV = "Comprobante/Conceptos/Concepto/@ClaveProdServ";
const FIELD_PATH_CLAVE_UNIDAD = "Comprobante/Conceptos/Concepto/@ClaveUnidad";

/**
 * ruleId: claveprodserv-claveunidad-vigente (engine/rules/registry.json).
 *
 * Two independent per-Concepto checks, each capable of firing its own Finding:
 * - Concepto/@ClaveProdServ must resolve to a vigente row (as of Comprobante/@Fecha) in
 *   cfdi_40_productos_servicios.
 * - Concepto/@ClaveUnidad must resolve to a vigente row in cfdi_40_claves_unidades.
 *
 * Scope (see registry.json notes #1): existence alone is already guaranteed by XSD
 * validation (both catalogs are xs:enumeration-typed in catCFDI.xsd) — what this rule
 * adds is the *vigencia* dimension (still valid as of this specific comprobante's
 * Fecha, not just valid at XSD-generation time) and a defense against corpus/xsd vs.
 * catalogs.db drift. Severity is "warning", not "error", because no CFDI40xxx rejection
 * code was found specific to this temporal check (registry.json notes #1).
 */
export function claveprodservClaveunidadVigente(parsed: ParsedCfdi, catalogs: CatalogSource): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const findings: Finding[] = [];

  parsed.Conceptos.Concepto.forEach((concepto, conceptoIndex) => {
    const claveProdServRow = catalogs.findVigente(
      "cfdi_40_productos_servicios",
      concepto.ClaveProdServ,
      asOfDate,
    );
    if (!claveProdServRow) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH_CLAVE_PROD_SERV,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: { claveProdServ: concepto.ClaveProdServ, conceptoIndex },
      });
    }

    const claveUnidadRow = catalogs.findVigente(
      "cfdi_40_claves_unidades",
      concepto.ClaveUnidad,
      asOfDate,
    );
    if (!claveUnidadRow) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH_CLAVE_UNIDAD,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: { claveUnidad: concepto.ClaveUnidad, conceptoIndex },
      });
    }
  });

  return findings;
}
