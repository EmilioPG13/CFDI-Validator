import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogRow, CatalogSource } from "../catalogs.ts";
import { decimalEquals, sumDecimal } from "../decimal.ts";

// Verbatim from engine/rules/registry.json, ruleId "impuestos-totales-consistencia" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "impuestos-totales-consistencia";
const FIELD_PATH =
  "Comprobante/Impuestos/@TotalImpuestosTrasladados, validado contra la suma de Comprobante/Impuestos/Traslados/Traslado/@Importe; y Comprobante/Impuestos/@TotalImpuestosRetenidos, validado contra la suma de Comprobante/Impuestos/Retenciones/Retencion/@Importe";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0, nodo Impuestos, campos TotalImpuestosRetenidos (p. 34-35/123) y TotalImpuestosTrasladados (p. 35-36/123) (extraído de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía pdftotext -layout): 'Es el total de los impuestos retenidos que se desprenden de los conceptos contenidos en el comprobante fiscal, el cual debe ser igual a la suma de los importes registrados en la sección Retenciones, no se permiten valores negativos y es requerido cuando en los conceptos se registren impuestos retenidos.' Y, análogamente: 'Es el total de los impuestos trasladados que se desprenden de los conceptos contenidos en el comprobante fiscal, el cual debe ser igual a la suma de los importes registrados en la sección Traslados, no se permiten valores negativos y es requerido cuando en los conceptos se registren impuestos trasladados.' Código oficial CFDI40203 (Retenciones) — verificado en 3 fuentes independientes (satfacil.com.mx/errores-sat vía fetch, gncys.com/anexo20/errores/CFDI40203, facturacioncfdimexico.blogspot.com): 'El valor del campo TotalImpuestosRetenidos debe ser igual a la suma de los importes registrados en el elemento hijo Retencion.' Código oficial CFDI40205 (Traslados) — verificado en 2 fuentes independientes (gncys.com/anexo20/errores/CFDI40205 vía facturacioncfdimexico.blogspot.com que reproduce el mismo texto, y la propia búsqueda cruzada contra CFDI40203): 'El valor del campo TotalImpuestosTrasladados no es igual a la suma de los importes registrados en el elemento hijo Traslado.'";

interface MonedaRow extends CatalogRow {
  decimales: number;
}

/** cfdi_40_monedas.decimales for Comprobante/@Moneda as of Comprobante/@Fecha, falling
 *  back to 2 if the moneda doesn't resolve to a vigente catalog row — same fallback
 *  convention as the other arithmetic rules in this batch. */
function resolveDecimales(parsed: ParsedCfdi, catalogs: CatalogSource, asOfDate: string): number {
  const row = catalogs.findVigente<MonedaRow>("cfdi_40_monedas", parsed.Moneda, asOfDate);
  return row?.decimales ?? 2;
}

/**
 * ruleId: impuestos-totales-consistencia (engine/rules/registry.json).
 *
 * Two independent checks, each capable of producing its own Finding:
 * - Comprobante/Impuestos/@TotalImpuestosRetenidos vs. the sum of every
 *   Retenciones/Retencion/@Importe (always present per the XSD — no "exento" concept
 *   for retenciones).
 * - Comprobante/Impuestos/@TotalImpuestosTrasladados vs. the sum of every
 *   Traslados/Traslado/@Importe, treating a missing @Importe (TipoFactor="Exento" rows
 *   omit it) as 0 — a documented XSD asymmetry (Retencion/@Importe is use=required,
 *   Traslado/@Importe is use=optional), not a data problem.
 *
 * Scope: only checks that the Comprobante/Impuestos summary attributes match their own
 * direct children — does NOT check those children against per-Concepto impuestos
 * (registry.json notes #1: that's a real, more complex rule, deliberately out of this
 * batch).
 */
export function impuestosTotalesConsistencia(parsed: ParsedCfdi, catalogs: CatalogSource): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const decimales = resolveDecimales(parsed, catalogs, asOfDate);
  const findings: Finding[] = [];
  const impuestos = parsed.Impuestos;

  if (impuestos?.Retenciones) {
    const sumaRetenciones = sumDecimal(impuestos.Retenciones.Retencion.map((r) => r.Importe));
    const totalRetenidos = impuestos.TotalImpuestosRetenidos;

    if (totalRetenidos === undefined) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "totalRetenidosAusente",
          sumaRetenciones,
          decimales,
        },
      });
    } else if (!decimalEquals(totalRetenidos, sumaRetenciones, decimales)) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "retencionesNoCoincide",
          totalRetenidosDeclarado: totalRetenidos,
          sumaRetenciones,
          decimales,
        },
      });
    }
  }

  if (impuestos?.Traslados) {
    // Traslado/@Importe is optional — a TipoFactor="Exento" row omits it and must sum
    // as 0, not be treated as missing/invalid data (registry.json condition, step 2).
    const sumaTraslados = sumDecimal(impuestos.Traslados.Traslado.map((t) => t.Importe ?? 0));
    const totalTrasladados = impuestos.TotalImpuestosTrasladados;

    if (totalTrasladados === undefined) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "totalTrasladadosAusente",
          sumaTraslados,
          decimales,
        },
      });
    } else if (!decimalEquals(totalTrasladados, sumaTraslados, decimales)) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "trasladosNoCoincide",
          totalTrasladadosDeclarado: totalTrasladados,
          sumaTraslados,
          decimales,
        },
      });
    }
  }

  return findings;
}
