import type { Finding } from "../finding.ts";
import type { ParsedCfdi, ParsedCfdiConceptoRetencion, ParsedCfdiTraslado } from "../parse.ts";
import { fechaAsDateOnly } from "../parse.ts";
import type { CatalogRow, SatCatalogs } from "../catalogs.ts";
import { decimalEquals, sumDecimal } from "../decimal.ts";

// Verbatim from engine/rules/registry.json, ruleId "impuestos-concepto-rollup-consistencia"
// — do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "impuestos-concepto-rollup-consistencia";
const FIELD_PATH =
  "Comprobante/Impuestos/Traslados/Traslado/@Base y @Importe, y Comprobante/Impuestos/Retenciones/Retencion/@Importe — validados contra la suma de Comprobante/Conceptos/Concepto/Impuestos/Traslados/Traslado/@Base y @Importe (agrupados por Impuesto+TipoFactor+TasaOCuota) y de Comprobante/Conceptos/Concepto/Impuestos/Retenciones/Retencion/@Importe (agrupado solo por Impuesto), respectivamente";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0 (texto extraído independientemente esta sesión de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía \"pdftotext -layout -f 34 -l 41\", page markers propios del documento verificados contra el pie de página, no inferidos): campo Importe de Retencion, p. 38/123: \"Se debe registrar el monto del impuesto retenido, el cual debe tener hasta la cantidad de decimales que soporte la moneda, no se permiten valores negativos y debe ser igual al redondeo de la suma de los importes de los impuestos retenidos registrados en los conceptos, donde el impuesto sea igual al campo impuesto de este elemento.\" — grupo: solo por Impuesto, consistente con \"Debe haber solo un registro por cada tipo de impuesto retenido\" (p. 37/123, justo antes). Campo Base de Traslado, p. 39/123: \"Se debe registrar el monto de la base del impuesto trasladado, agrupado por Impuesto, TipoFactor y TasaOCuota... debe ser igual al redondeo de la suma de los importes de los campos Base trasladados registrados en los conceptos, donde el impuesto del concepto sea igual al campo Impuesto de este apartado y la TasaOCuota del concepto sea igual al campo TasaOCuota de este apartado\" — y, para el caso Exento, en la misma página: \"En caso de que solo existan conceptos con TipoFactor Exento, la suma de este campo debe ser igual al redondeo de la suma de los importes de los campos Base registrados en los conceptos\" (es decir, el Base de un renglón Exento SÍ debe rolar desde los Conceptos, aunque ese renglón nunca tenga @Importe). Campo Importe de Traslado, p. 40-41/123 (la oración cruza el salto de página): \"Se puede registrar el monto del impuesto trasladado, agrupado por Impuesto, TipoFactor y TasaOCuota... debe ser igual al redondeo de la suma de los importes de los impuestos trasladados registrados en los conceptos, donde el impuesto del concepto sea igual al campo Impuesto de este apartado y la TasaOCuota del concepto sea igual al campo TasaOCuota de este apartado.\" xs:documentation nativa de cfdv40.xsd (fuente primaria del propio esquema oficial, confirmada leyendo el archivo directamente esta sesión): línea 624, atributo Base de Comprobante/Impuestos/Traslados/Traslado: \"Atributo requerido para señalar la suma de los atributos Base de los conceptos del impuesto trasladado.\"; línea 651, atributo Importe del mismo elemento: \"Atributo condicional para señalar la suma del importe del impuesto trasladado, agrupado por impuesto, TipoFactor y TasaOCuota.\" — ambas coinciden palabra por palabra en la lógica de agrupación con el Anexo 20 citado arriba, confirmando que XSD y Anexo 20 describen la misma regla desde dos ángulos distintos (comentario de esquema vs. guía de llenado). CÓDIGOS OFICIALES CFDI40 — la nota 1 de impuestos-totales-consistencia (batch anterior) señaló que \"no se buscó ni confirmó un código CFDI40 oficial específico para ella\" y la dejó pendiente; esta sesión SÍ los buscó activamente y encontró y confirmó tres, cada uno en ≥2 fuentes independientes (gncys.com y contadormx.net, con texto casi idéntico entre ambas) y los tres coinciden palabra por palabra con el Anexo 20 citado arriba: CFDI40211 (Retencion/@Importe) — \"El campo Importe correspondiente a Retención no es igual al redondeo de la suma de los importes de los impuestos retenidos registrados en los conceptos donde el impuesto sea igual al campo impuesto de este elemento\" (gncys.com/anexo20/4.0/errores/CFDI40211/; contadormx.net/info/error-cfdi40211-campo-importe-correspondiente-a-retencion/). CFDI40215 (Traslado/@Base) — \"El campo Importe correspondiente a Traslado no es igual al redondeo de la suma de los importes de las bases trasladados registrados en los conceptos donde el impuesto del concepto sea igual al campo impuesto de este elemento y la TasaOCuota del concepto sea igual al campo TasaOCuota de este elemento\" (gncys.com/anexo20/4.0/errores/CFDI40215/; contadormx.net/info/error-cfdi40215-importe-correspondiente-a-traslado-no-es-igual-al-redondeo/ — el título corto de este código dice \"Importe\" pero su propio texto y el elemento/atributo declarado en ambas fuentes, \"cfdi:Impuestos:Traslados/Traslado, Atributo: Base\", confirman que es el chequeo de Base, no de Importe; posible inconsistencia de nomenclatura del propio catálogo de errores entre el nombre corto del código y su contenido, no un error de esta investigación). CFDI40221 (Traslado/@Importe) — \"El campo Importe correspondiente a Traslado no es igual al redondeo de la suma de los importes de los impuestos trasladados registrados en los conceptos donde el impuesto del concepto sea igual al campo impuesto de este elemento y la TasaOCuota del concepto sea igual al campo TasaOCuota de este elemento\" (gncys.com/anexo20/4.0/errores/CFDI40221/; contadormx.net/info/error-cfdi40221-importe-correspondiente-a-traslado-no-es-igual-al-redondeo/). DOS CÓDIGOS VISTOS PERO DELIBERADAMENTE NO USADOS, para que quede explícito que no se ignoraron sin más: CFDI40214 y CFDI40216 aparecieron en la misma búsqueda con mensajes muy similares a CFDI40215 (también sobre Traslado/Base) pero cada uno con una sola fuente y con texto ambiguo entre sí (posible duplicado, código relacionado con decimales en vez de redondeo/suma, o variante que esta sesión no logró desambiguar con confianza) — no se citan como fundamento de esta regla; si se decide investigarlos a fondo en el futuro, probablemente uno de los dos sea en realidad el chequeo de \"cantidad de decimales que soporte la moneda\" (paralelo a cómo CFDI40210 es el chequeo de decimales para Retencion/@Importe, distinto de CFDI40211 que es el chequeo de redondeo/suma) y no una regla de rollup por derecho propio.";

interface MonedaRow extends CatalogRow {
  decimales: number;
}

/** cfdi_40_monedas.decimales for Comprobante/@Moneda as of Comprobante/@Fecha, falling
 *  back to 2 if the moneda doesn't resolve to a vigente catalog row — same fallback
 *  convention as the other arithmetic rules in this registry. */
function resolveDecimales(parsed: ParsedCfdi, catalogs: SatCatalogs, asOfDate: string): number {
  const row = catalogs.findVigente<MonedaRow>("cfdi_40_monedas", parsed.Moneda, asOfDate);
  return row?.decimales ?? 2;
}

/** Every Concepto-level Traslado across all Conceptos, flattened for matching against a
 *  single Comprobante-level Traslado row. */
function allConceptoTraslados(parsed: ParsedCfdi): ParsedCfdiTraslado[] {
  return parsed.Conceptos.Concepto.flatMap((c) => c.Impuestos?.Traslados?.Traslado ?? []);
}

/** Every Concepto-level Retencion across all Conceptos, flattened for matching against a
 *  single Comprobante-level Retencion row. */
function allConceptoRetenciones(parsed: ParsedCfdi): ParsedCfdiConceptoRetencion[] {
  return parsed.Conceptos.Concepto.flatMap((c) => c.Impuestos?.Retenciones?.Retencion ?? []);
}

/**
 * ruleId: impuestos-concepto-rollup-consistencia (engine/rules/registry.json).
 *
 * Deeper than impuestos-totales-consistencia: that rule checks the Resumen
 * (TotalImpuestosTrasladados/Retenidos) against its own immediate Traslado/Retencion
 * rows; this rule checks those SAME rows against the Concepto-level detail that is
 * supposed to sustain them. A document can pass one and fail the other.
 *
 * Three independent sub-cases, each capable of its own Finding, matching
 * registry.json's condition exactly:
 * - Traslado/@Base, grouped by (Impuesto, TasaOCuota) — TasaOCuota is absent for both
 *   Comprobante- and Concepto-level Exento rows, so `null === null` matches correctly
 *   without a separate TipoFactor comparison (registry.json condition, step 1a).
 * - Traslado/@Importe, same grouping, evaluated only when TipoFactor !== "Exento" (an
 *   Exento row never carries @Importe — already enforced by impuestos-totales-
 *   consistencia, not re-checked here).
 * - Retencion/@Importe, grouped by Impuesto only (never TasaOCuota/TipoFactor/Base,
 *   even though Concepto-level Retencion has those as required fields — the Anexo 20
 *   is explicit that only @Impuesto is used for this match).
 */
export function impuestosConceptoRollupConsistencia(
  parsed: ParsedCfdi,
  catalogs: SatCatalogs,
): Finding[] {
  const asOfDate = fechaAsDateOnly(parsed);
  const decimales = resolveDecimales(parsed, catalogs, asOfDate);
  const findings: Finding[] = [];
  const impuestos = parsed.Impuestos;

  if (!impuestos) {
    return findings;
  }

  if (impuestos.Traslados) {
    const conceptoTraslados = allConceptoTraslados(parsed);

    for (const r of impuestos.Traslados.Traslado) {
      const match = conceptoTraslados.filter(
        (c) => c.Impuesto === r.Impuesto && (c.TasaOCuota ?? null) === (r.TasaOCuota ?? null),
      );

      const sumaBase = sumDecimal(match.map((c) => c.Base));
      if (!decimalEquals(r.Base, sumaBase, decimales)) {
        findings.push({
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: {
            subcaso: "trasladoBaseNoCoincide",
            impuesto: r.Impuesto,
            tipoFactor: r.TipoFactor,
            tasaOCuota: r.TasaOCuota,
            baseDeclarada: r.Base,
            baseCalculada: sumaBase,
          },
        });
      }

      // Exento rows never carry @Importe (impuestos-totales-consistencia already
      // covers that absence) — nothing to roll up here for that branch.
      if (r.TipoFactor !== "Exento") {
        const sumaImporte = sumDecimal(match.map((c) => c.Importe ?? 0));
        if (!decimalEquals(r.Importe ?? 0, sumaImporte, decimales)) {
          findings.push({
            ruleId: RULE_ID,
            fieldPath: FIELD_PATH,
            severity: SEVERITY,
            satReference: SAT_REFERENCE,
            evidence: {
              subcaso: "trasladoImporteNoCoincide",
              impuesto: r.Impuesto,
              tipoFactor: r.TipoFactor,
              tasaOCuota: r.TasaOCuota,
              importeDeclarado: r.Importe,
              importeCalculado: sumaImporte,
            },
          });
        }
      }
    }
  }

  if (impuestos.Retenciones) {
    const conceptoRetenciones = allConceptoRetenciones(parsed);

    for (const r of impuestos.Retenciones.Retencion) {
      const match = conceptoRetenciones.filter((c) => c.Impuesto === r.Impuesto);
      const sumaImporte = sumDecimal(match.map((c) => c.Importe));

      if (!decimalEquals(r.Importe, sumaImporte, decimales)) {
        findings.push({
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: {
            subcaso: "retencionImporteNoCoincide",
            impuesto: r.Impuesto,
            importeDeclarado: r.Importe,
            importeCalculado: sumaImporte,
          },
        });
      }
    }
  }

  return findings;
}
