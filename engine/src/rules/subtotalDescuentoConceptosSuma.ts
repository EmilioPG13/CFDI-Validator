import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogRow, CatalogSource } from "../catalogTypes.ts";
import { decimalEquals, sumDecimal } from "../decimal.ts";

// Verbatim from engine/rules/registry.json, ruleId "subtotal-descuento-conceptos-suma" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "subtotal-descuento-conceptos-suma";
const FIELD_PATH =
  "Comprobante/@SubTotal y Comprobante/@Descuento, validados contra la suma de Comprobante/Conceptos/Concepto/@Importe y Comprobante/Conceptos/Concepto/@Descuento respectivamente";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0, sección 'Estándar del comprobante fiscal digital por Internet', campo SubTotal, p. 8/123 (extraído de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía pdftotext -layout): 'Es la suma de los importes de los conceptos antes de descuentos e impuestos. No se permiten valores negativos. (...) Cuando en el campo TipoDeComprobante sea \"I\" (Ingreso), \"E\" (Egreso) o \"N\" (Nómina), el importe registrado en este campo debe ser igual al redondeo de la suma de los importes de los conceptos registrados. Cuando en el campo TipoDeComprobante sea \"T\" (Traslado) o \"P\" (Pago) el importe registrado en este campo debe ser igual a cero.' Mismo campo, p. 8-9/123, sobre Descuento: 'El valor registrado en este campo debe ser menor o igual que el campo Subtotal. (...) Cuando en el campo TipoDeComprobante sea \"I\" (Ingreso), \"E\" (Egreso) o \"N\" (Nómina) y algún concepto incluya un descuento, este campo debe existir y debe ser igual al redondeo de la suma de los campos Descuento registrados en los conceptos; en otro caso se debe omitir este campo.' Metodología de redondeo — Anexo 20, sección de Preguntas Frecuentes, pregunta 37, p. 87-88/123: 'por cada concepto de la factura se puede utilizar de cero hasta seis decimales como máximo y en los totales se debe redondear al final del cálculo el resultado al número de decimales que soporta la moneda' (con ejemplo trabajado: suma de 4 partidas con 4 decimales = 0.7104, redondeado a 2 decimales para MXN = 0.71); pregunta 39, p. 89-90/123, confirma explícitamente el mapeo de campos: 'En el caso del Importe de los Conceptos, el redondeo aplicará en el campo SubTotal del comprobante. En el caso de los Descuentos de los Conceptos, el redondeo aplicará en el campo Descuento del comprobante.' Código oficial de rechazo CFDI40108 — mensaje verificado en 3 fuentes independientes (satfacil.com.mx/errores-sat, gncys.com/anexo20/4.0/errores/CFDI40108/, contadormx.net/info/error-cfdi40108-tipodecomprobante-es-ie-o-n/): 'El TipoDeComprobante es I,E o N, el importe registrado en el campo no es igual al redondeo de la suma de los importes de los conceptos registrados.' Código oficial CFDI40111 (Descuento) — verificado en 2 fuentes independientes (gncys.com/anexo20/4.0/errores/CFDI40111/, blog.misolucionaqui.com/2023/08/19/cfdi40111-...): 'El TipoDeComprobante no es I,E o N, y un concepto incluye el campo descuento' — esta es la contraparte de presencia/ausencia del mismo campo; la propia página de gncys.com para CFDI40111 cita también la regla de suma en su descripción de la validación, confirmando el texto de Anexo 20 arriba. Un caso práctico real citado en un foro de contadores (búsqueda web, no verificado contra el original) reporta exactamente este tipo de descuadre: Descuento esperado 81.47 vs. reportado 81.46 — corrobora que este es un modo de falla real, no solo teórico.";

interface MonedaRow extends CatalogRow {
  decimales: number;
}

/** cfdi_40_monedas.decimales for Comprobante/@Moneda as of Comprobante/@Fecha, falling
 *  back to 2 if the moneda doesn't resolve to a vigente catalog row (per registry.json's
 *  own condition text for this rule). */
function resolveDecimales(parsed: ParsedCfdi, catalogs: CatalogSource, asOfDate: string): number {
  const row = catalogs.findVigente<MonedaRow>("cfdi_40_monedas", parsed.Moneda, asOfDate);
  return row?.decimales ?? 2;
}

/**
 * ruleId: subtotal-descuento-conceptos-suma (engine/rules/registry.json).
 *
 * Branches explicitly on TipoDeComprobante, per the spec:
 * - T/P: Comprobante/@SubTotal must be exactly 0. Descuento presence is out of this
 *   rule's arithmetic scope (see registry.json notes #4) — not checked here.
 * - I/E/N: Comprobante/@SubTotal must equal the (once-at-the-end-rounded) sum of every
 *   Concepto/@Importe. Separately, Comprobante/@Descuento's presence/value is checked
 *   against the sum of Concepto/@Descuento (treating conceptos without one as 0).
 *
 * Can return more than one Finding (a SubTotal mismatch and a Descuento mismatch are
 * independent failures) — both share this same ruleId, consistent with "one rule, one
 * function" (CLAUDE.md): this is still one rule, just one that can flag two distinct
 * offending fields on the same document.
 */
export function subtotalDescuentoConceptosSuma(
  parsed: ParsedCfdi,
  catalogs: CatalogSource,
): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const decimales = resolveDecimales(parsed, catalogs, asOfDate);
  const findings: Finding[] = [];

  if (parsed.TipoDeComprobante === "T" || parsed.TipoDeComprobante === "P") {
    if (!decimalEquals(parsed.SubTotal, 0, decimales)) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "subtotalNoCero",
          tipoDeComprobante: parsed.TipoDeComprobante,
          subtotalDeclarado: parsed.SubTotal,
        },
      });
    }
    return findings;
  }

  // I / E / N from here on.
  const conceptos = parsed.Conceptos.Concepto;
  const conceptosImportes = conceptos.map((c) => c.Importe);
  const sumaCalculada = sumDecimal(conceptosImportes);

  if (!decimalEquals(parsed.SubTotal, sumaCalculada, decimales)) {
    findings.push({
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: {
        subCaso: "subtotalNoCoincide",
        subtotalDeclarado: parsed.SubTotal,
        sumaCalculada,
        decimales,
        conceptosImportes,
      },
    });
  }

  const conceptosConDescuento = conceptos.filter((c) => c.Descuento !== undefined);

  if (conceptosConDescuento.length > 0) {
    const sumaDescuentoCalculada = sumDecimal(conceptos.map((c) => c.Descuento ?? 0));
    if (parsed.Descuento === undefined) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "descuentoAusente",
          sumaCalculada: sumaDescuentoCalculada,
          decimales,
        },
      });
    } else if (!decimalEquals(parsed.Descuento, sumaDescuentoCalculada, decimales)) {
      findings.push({
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: {
          subCaso: "descuentoNoCoincide",
          descuentoDeclarado: parsed.Descuento,
          sumaCalculada: sumaDescuentoCalculada,
          decimales,
        },
      });
    }
  } else if (parsed.Descuento !== undefined) {
    findings.push({
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: {
        subCaso: "descuentoInesperado",
        descuentoDeclarado: parsed.Descuento,
      },
    });
  }

  return findings;
}
