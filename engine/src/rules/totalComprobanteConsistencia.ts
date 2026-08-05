import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogRow, SatCatalogs } from "../catalogs.ts";
import { decimalEquals } from "../decimal.ts";

// Verbatim from engine/rules/registry.json, ruleId "total-comprobante-consistencia" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "total-comprobante-consistencia";
const FIELD_PATH =
  "Comprobante/@Total, validado contra Comprobante/@SubTotal, Comprobante/@Descuento, Comprobante/Impuestos/@TotalImpuestosTrasladados y Comprobante/Impuestos/@TotalImpuestosRetenidos";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0, campo Total, p. 9-10/123 (extraído de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía pdftotext -layout): 'Es la suma del subtotal, menos los descuentos aplicables, más las contribuciones recibidas (impuestos trasladados federales o locales, derechos, productos, aprovechamientos, aportaciones de seguridad social, contribuciones de mejoras) menos los impuestos retenidos federales y/o locales. No se permiten valores negativos. (...) Cuando el campo TipoDeComprobante sea \"T\" (Traslado) o \"P\" (Pago), el importe registrado en este campo debe ser igual a cero.' Código oficial de rechazo CFDI40119 — verificado en 2 fuentes independientes (gncys.com/anexo20/4.0/errores/CFDI40119/, factura.cfdi.red/blog-facturacion-electronica/como-solucionar-el-error-cfdi40119-.../): 'El campo Total no corresponde con la suma del subtotal, menos los descuentos aplicables, más las contribuciones recibidas (impuestos trasladados - federales o locales, derechos, productos, aprovechamientos, aportaciones de seguridad social, contribuciones de mejoras) menos los impuestos retenidos y/o locales' — texto casi idéntico al de Anexo 20, lo que corrobora que ambas fuentes citan la misma regla. Nota importante encontrada en el propio Anexo 20 junto a la definición de Total: la validación del LÍMITE MÁXIMO de este campo (relacionada con el campo Confirmacion) está marcada como 'vigente únicamente a partir de que el SAT publique en su Portal los procedimientos para generar la clave de confirmación' — es decir, esa parte específica de la validación de Total (no la aritmética SubTotal-Descuento+Impuestos que sí es la base de esta regla) el propio SAT la describe como condicionalmente vigente; no se incluye en el alcance de esta regla por depender de un procedimiento externo no confirmado como publicado.";

interface MonedaRow extends CatalogRow {
  decimales: number;
}

/** cfdi_40_monedas.decimales for Comprobante/@Moneda as of Comprobante/@Fecha, falling
 *  back to 2 if the moneda doesn't resolve to a vigente catalog row — same fallback
 *  convention as subtotal-descuento-conceptos-suma. */
function resolveDecimales(parsed: ParsedCfdi, catalogs: SatCatalogs, asOfDate: string): number {
  const row = catalogs.findVigente<MonedaRow>("cfdi_40_monedas", parsed.Moneda, asOfDate);
  return row?.decimales ?? 2;
}

/**
 * ruleId: total-comprobante-consistencia (engine/rules/registry.json).
 *
 * Branches explicitly on TipoDeComprobante, per the spec:
 * - T/P: Comprobante/@Total must be exactly 0.
 * - I/E: Comprobante/@Total must equal SubTotal - Descuento + TotalImpuestosTrasladados
 *   - TotalImpuestosRetenidos (missing Descuento/Impuestos fields treated as 0),
 *   rounded once at the end.
 * - N (Nómina): same formula, but Impuestos must not exist at all per Anexo 20's
 *   presence rules for this TipoDeComprobante — TotalImpuestosTrasladados/Retenidos are
 *   therefore treated as 0 unconditionally, never read off parsed.Impuestos even if a
 *   malformed document happens to carry one. The formula reduces to Total = SubTotal -
 *   Descuento. Findings from this sub-case carry evidence.subCaso = "N" so the Explainer
 *   doesn't mistake the reduced formula for a bug in this rule.
 *
 * Independent from subtotal-descuento-conceptos-suma and impuestos-totales-consistencia
 * (registry.json notes #1): a document can pass one and fail the other.
 */
export function totalComprobanteConsistencia(parsed: ParsedCfdi, catalogs: SatCatalogs): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const decimales = resolveDecimales(parsed, catalogs, asOfDate);

  if (parsed.TipoDeComprobante === "T" || parsed.TipoDeComprobante === "P") {
    if (decimalEquals(parsed.Total, 0, decimales)) {
      return [];
    }
    return [
      {
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "TP",
          tipoDeComprobante: parsed.TipoDeComprobante,
          totalDeclarado: parsed.Total,
        },
      },
    ];
  }

  const subTotal = parsed.SubTotal;
  const descuento = parsed.Descuento ?? 0;

  let totalImpuestosTrasladados: string | number;
  let totalImpuestosRetenidos: string | number;
  let subCaso: "IE" | "N";

  if (parsed.TipoDeComprobante === "N") {
    // Impuestos must not exist for Nómina (Anexo 20 p. 10-11/123) — never read it here
    // even if present, per the spec's explicit instruction.
    totalImpuestosTrasladados = 0;
    totalImpuestosRetenidos = 0;
    subCaso = "N";
  } else {
    // I / E
    totalImpuestosTrasladados = parsed.Impuestos?.TotalImpuestosTrasladados ?? 0;
    totalImpuestosRetenidos = parsed.Impuestos?.TotalImpuestosRetenidos ?? 0;
    subCaso = "IE";
  }

  const totalCalculado =
    Number(subTotal) - Number(descuento) + Number(totalImpuestosTrasladados) - Number(totalImpuestosRetenidos);

  if (decimalEquals(parsed.Total, totalCalculado, decimales)) {
    return [];
  }

  return [
    {
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: {
        subCaso,
        totalDeclarado: parsed.Total,
        totalCalculado,
        subTotal,
        descuento,
        totalImpuestosTrasladados,
        totalImpuestosRetenidos,
      },
    },
  ];
}
