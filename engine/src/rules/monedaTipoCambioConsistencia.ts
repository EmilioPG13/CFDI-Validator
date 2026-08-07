import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { CatalogSource } from "../catalogs.ts";

// Verbatim from engine/rules/registry.json, ruleId "moneda-tipocambio-consistencia" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "moneda-tipocambio-consistencia";
const FIELD_PATH = "Comprobante/@TipoCambio, validado contra Comprobante/@Moneda";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "corpus/xsd/cfd/4/cfdv40.xsd, línea 799-801, xs:documentation del atributo TipoCambio (fuente primaria, texto de la propia definición del esquema oficial del SAT, no de un tercero): 'Atributo condicional para representar el tipo de cambio FIX conforme con la moneda usada. Es requerido cuando la clave de moneda es distinta de MXN y de XXX.' Confirmado casi verbatim en Anexo 20 Guía de llenado CFDI v4.0, campo Moneda/TipoCambio, p. 8-9/123 (extraído de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía pdftotext -layout): 'Se puede registrar el tipo de cambio FIX conforme a la moneda registrada en el comprobante. Este campo es requerido cuando la clave de moneda es distinta de \"MXN\" (Peso Mexicano) y a la clave \"XXX\" (Los códigos asignados para las transacciones en que intervenga ninguna moneda).' corpus/catalogs/catalogs.db, tabla cfdi_40_monedas, confirma que MXN y XXX son ambos códigos vigentes reales (id='XXX', texto='Los códigos asignados para las transacciones en que intervenga ninguna moneda' — coincide palabra por palabra con el paréntesis del Anexo 20, corroborando que catalogs.db y el Anexo 20 describen la misma semántica para XXX). Para las dos ramas específicas MXN→'debe ser 1 o ausente' y XXX→'debe estar ausente' — NO están dichas explícitamente en esas palabras ni en el XSD ni en el Anexo 20 (ambas fuentes primarias solo dicen 'requerido cuando != MXN y != XXX', lo cual implica lógicamente 'no requerido' en los otros dos casos, pero no dice literalmente 'prohibido' ni 'debe ser 1'): esas dos ramas se sostienen en códigos oficiales de rechazo corroborados en fuentes secundarias independientes. CFDI40114 (rama MXN) — verificado en 2 fuentes independientes (gncys.com/anexo20/4.0/errores/CFDI40114/: 'El campo TipoCambio no tiene el valor \"1\" y la moneda indicada es MXN'; herramientasfiscales.mx/blog/error-moneda-tipo-cambio-cfdi, que describe la misma regla con redacción distinta pero el mismo código y el mismo efecto). CFDI40115 (rama moneda extranjera, campo ausente) — mencionado en herramientasfiscales.mx/blog/error-moneda-tipo-cambio-cfdi: 'Falta el tipo de cambio para moneda extranjera' — esta cita tiene un solo respaldo directo verificado en esta sesión (no se encontró una segunda fuente independiente que reproduzca el texto exacto de CFDI40115 más allá de la búsqueda agregada que ya incluye ese mismo blog); tratar el número de código CFDI40115 específicamente con más cautela que los demás códigos citados en este registry, aunque la REGLA en sí (TipoCambio requerido para moneda extranjera) sí tiene respaldo sólido de doble fuente primaria (XSD + Anexo 20). La rama XXX→ausente tiene un solo respaldo secundario directo (herramientasfiscales.mx) sin segunda fuente independiente encontrada en esta sesión; es la afirmación más débil de esta regla — marcar como tal.";

/**
 * ruleId: moneda-tipocambio-consistencia (engine/rules/registry.json).
 *
 * Three branches on Comprobante/@Moneda, each independently checked:
 * - MXN: TipoCambio, if present, must be exactly 1 — an EXACT comparison, not a
 *   tolerant one. The spec's condition text is explicit about this ("comparación
 *   exacta, no de rango — 'debe ser 1', no 'aproximadamente 1'"), deliberately unlike
 *   the other 3 arithmetic rules in this batch, which use decimal.ts's decimalEquals
 *   with a ±1-ULP tolerance to absorb Anexo 20's documented rounding-mode ambiguity
 *   for *summed* values. TipoCambio=1 isn't a sum with a rounding step — it's a
 *   single declared value the spec says must be the literal number 1, so
 *   Number(tipoCambio) !== 1 is the correct check here, not decimalEquals. (An
 *   earlier implementation pass used decimalEquals for this branch by mistake, which
 *   would have silently let "1.000001" or "0.999999" pass as "1" — caught in review
 *   and fixed; the fixture's own fail case uses TipoCambio="1.500000", which is wrong
 *   under either comparison, so it didn't catch this on its own.)
 * - XXX: TipoCambio must not be present at all (registry.json flags this as the
 *   weakest-cited of the three branches — implemented as specified regardless).
 * - any other (real foreign currency): TipoCambio must be present.
 *
 * Deliberately does NOT validate TipoCambio's value against cfdi_40_monedas'
 * porcentaje_variacion band around the Banxico/DOF FIX rate — that requires a live
 * exchange-rate source this project doesn't have (see registry.json notes #1).
 */
export function monedaTipoCambioConsistencia(parsed: ParsedCfdi, _catalogs: CatalogSource): Finding[] {
  const moneda = parsed.Moneda;
  const tipoCambio = parsed.TipoCambio;

  if (moneda === "MXN") {
    if (tipoCambio !== undefined && Number(tipoCambio) !== 1) {
      return [
        {
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: { moneda: "MXN", tipoCambio },
        },
      ];
    }
    return [];
  }

  if (moneda === "XXX") {
    if (tipoCambio !== undefined) {
      return [
        {
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: { moneda: "XXX", tipoCambio },
        },
      ];
    }
    return [];
  }

  // Any other value: a real foreign currency, TipoCambio is required.
  if (tipoCambio === undefined) {
    return [
      {
        ruleId: RULE_ID,
        fieldPath: FIELD_PATH,
        severity: SEVERITY,
        satReference: SAT_REFERENCE,
        evidence: { moneda },
      },
    ];
  }
  return [];
}
