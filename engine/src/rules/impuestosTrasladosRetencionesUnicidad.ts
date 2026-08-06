import type { Finding } from "../finding.ts";
import type { ParsedCfdi, ParsedCfdiTraslado, ParsedCfdiRetencion } from "../parse.ts";

// Verbatim from engine/rules/registry.json, ruleId "impuestos-traslados-retenciones-unicidad"
// — do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "impuestos-traslados-retenciones-unicidad";
const FIELD_PATH =
  "Comprobante/Impuestos/Traslados/Traslado (agrupado por la combinación de sus atributos @Impuesto + @TipoFactor + @TasaOCuota) y Comprobante/Impuestos/Retenciones/Retencion (agrupado solo por @Impuesto) — EXCLUSIVAMENTE a nivel Comprobante/Impuestos. Concepto/Impuestos/Traslados/Traslado y Concepto/Impuestos/Retenciones/Retencion quedan fuera de alcance de esta regla; ver 'satReference' para la verificación explícita (no asumida) de que el Anexo 20 no extiende esta unicidad a ese nivel.";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0 (texto extraído independientemente esta sesión de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía \"pdftotext -layout\" sobre el DOCUMENTO COMPLETO, no solo el rango de páginas que ya usaron 'impuestos-totales-consistencia' e 'impuestos-concepto-rollup-consistencia' — número de página confirmado contando físicamente los marcadores de pie de página \"N / 123\" línea por línea sobre el texto extraído completo, el mismo método de verificación por conteo que 'emisor-efos-69b-sat' ya usó para corregir un rango de página impreciso, no inferido de un índice ni reutilizado de otra regla sin re-derivar): nodo Retencion, p. 37/123: \"Debe haber solo un registro por cada tipo de impuesto retenido.\" — re-confirma verbatim, de forma independiente, la misma frase que 'impuestos-totales-consistencia' ya cita para otro propósito. Nodo Traslado, p. 39/123 (el marcador de pie de página \"38 / 123\" aparece INMEDIATAMENTE ANTES de esta frase y \"39 / 123\" aparece DESPUÉS en el texto extraído — la frase pertenece por tanto a la página 39, no a la 38): \"Debe haber solo un registro con la misma combinación de impuesto, factor y tasa por cada traslado.\" — re-confirma verbatim la cita que la nota 4 de 'impuestos-concepto-rollup-consistencia' dejó pendiente de fetch individual (\"visto en el índice de gncys.com pero NO fetcheado individualmente ni confirmado verbatim\"). ALCANCE COMPROBANTE-VS-CONCEPTO, investigado activamente y no asumido: la cadena \"solo un registro\" aparece EXACTAMENTE DOS VECES en las 123 páginas del documento completo (grep sobre el texto extraído íntegro, no una muestra) — las dos ya citadas arriba, ambas dentro de la sección Comprobante/Impuestos (pp. 37 y 39/123). La sección que documenta Concepto/Impuestos/Traslados/Traslado y Concepto/Impuestos/Retenciones/Retencion (pp. 24-28/123, un bloque de texto distinto, extraído y leído íntegramente esta sesión) NO contiene ninguna variante de esa frase — al contrario, dice explícitamente lo opuesto para Traslado a nivel Concepto: \"En el caso de que un concepto contenga impuesto trasladado por Tasa y Cuota, se debe expresar en diferentes apartados\" (p. 25/123) y el mismo patrón para Retencion (p. 27/123: \"En el caso de que un concepto contenga impuesto retenido por Tasa y Cuota, se debe expresar en diferentes apartados\") — es decir, a nivel Concepto SÍ pueden coexistir varios renglones para el mismo Impuesto cuando el TipoFactor difiere, y el Anexo 20 en ningún momento prohíbe ni insinúa una restricción de unicidad adicional a ese nivel. Por lo tanto esta regla se limita EXCLUSIVAMENTE a Comprobante/Impuestos — confirmado por ausencia de evidencia textual tras una búsqueda activa, no asumido por simetría con las reglas hermanas que sí operan a nivel Concepto para otros propósitos (p. ej. 'impuestos-concepto-rollup-consistencia'). CÓDIGOS OFICIALES CFDI40, ambos fetcheados INDIVIDUALMENTE esta sesión (no solo vistos en un índice — cerrando exactamente la brecha que la nota 4 de 'impuestos-concepto-rollup-consistencia' dejó abierta): CFDI40218 (Traslado) — confirmado en 2 fuentes independientes fetcheadas por separado (gncys.com/anexo20/4.0/errores/CFDI40218/: \"Debe haber sólo un registro con la misma combinación de impuesto, factor y tasa por cada traslado.\", elemento cfdi:Impuestos:Traslados/Traslado; contadormx.net/info/error-cfdi40218-registro-con-la-misma-combinacion-de-impuesto-factor-y-tasa/: texto verbatim idéntico) — coincide palabra por palabra con el Anexo 20 citado arriba salvo el acento en \"sólo\" (el PDF del Anexo 20 lo omite, ambas fuentes web lo incluyen; diferencia tipográfica de tilde diacrítica, no de contenido). CFDI40208 (Retencion) — código que NO estaba identificado en el batch anterior en absoluto (la nota 4 de 'impuestos-concepto-rollup-consistencia' solo mencionaba un candidato para Traslado, ninguno para Retencion); localizado esta sesión buscando activamente en el rango de códigos vecino a la familia ya confirmada CFDI40203/40205/40211 (Retenciones) y confirmado en 2 fuentes independientes fetcheadas por separado (gncys.com/anexo20/4.0/errores/CFDI40208/: \"Debe haber sólo un registro por cada tipo de impuesto retenido.\", elemento cfdi:Impuestos:Retenciones/Retencion; contadormx.net/info/error-cfdi40208-registro-por-cada-tipo-de-impuesto-retenido/: texto verbatim idéntico) — confirma que son DOS códigos distintos, uno por nodo, no un código compartido, resolviendo explícitamente la pregunta que el orquestador planteó. Se revisaron también los códigos vecinos de Traslado CFDI40217 (mismo elemento, catálogo c_Impuesto: \"El campo Impuesto no contiene un valor del catálogo c_Impuesto\") y CFDI40219 (mismo elemento, catálogo c_TasaOCuota) para descartar que la unicidad estuviera codificada bajo un número distinto de 40218 — ambos resultaron ser validaciones de catálogo, no de unicidad, lo que corrobora 40218 como el código correcto y único candidato en su vecindario. corpus/xsd/cfd/4/cfdv40.xsd: confirmado leyendo el archivo completo que NINGÚN xs:key ni xs:unique existe en todo el esquema (grep sobre el archivo entero, 0 resultados) y que Comprobante/Impuestos/Traslados/Traslado (línea 617), Comprobante/Impuestos/Retenciones/Retencion (línea 591) y sus contrapartes a nivel Concepto (Concepto/Impuestos/Traslados/Traslado línea 202, Concepto/Impuestos/Retenciones/Retencion línea 257) están las cuatro declaradas con maxOccurs=\"unbounded\" sin restricción estructural de unicidad — la duplicación es válida para el XSD en los cuatro nodos, así que esta regla de negocio no está cubierta gratis por la Fase 1 (mismo patrón que 'tipodecomprobante-campos-prohibidos' y 'moneda-tipocambio-consistencia' ya documentan para sus propios campos: condicionalidad de negocio pura, sin xs:assert).";

/**
 * ruleId: impuestos-traslados-retenciones-unicidad (engine/rules/registry.json).
 *
 * Structural, not arithmetic — unlike impuestos-totales-consistencia and
 * impuestos-concepto-rollup-consistencia (which check that NUMBERS reconcile), this rule
 * checks that the Comprobante/Impuestos node has no redundant rows: at most one
 * Traslado per (Impuesto, TipoFactor, TasaOCuota) combination, and at most one
 * Retencion per Impuesto. No decimal comparison, no catalogs.db lookup — pure grouping
 * and counting, so this takes only `parsed` (see index.ts's Rule type: a function
 * declaring fewer params than Rule's signature is still structurally assignable to it,
 * same convention already used by tipodecomprobanteCamposProhibidos).
 *
 * Two independent sub-cases per registry.json's condition, each producing ONE Finding
 * per duplicated group (not one per combinatorial pair within the group):
 * - Traslado rows grouped by (Impuesto, TipoFactor, TasaOCuota ?? null) — same
 *   null-handling for Exento rows (no TasaOCuota) as impuestos-concepto-rollup-
 *   consistencia's trasladoKey (CFDI40218).
 * - Retencion rows grouped by Impuesto only — Comprobante-level Retencion has no
 *   Base/TipoFactor/TasaOCuota to group by (CFDI40208).
 *
 * Deliberately never evaluates Concepto-level Impuestos/Traslados or Impuestos/
 * Retenciones — registry.json's satReference confirms (by active grep over the full
 * Anexo 20 text, not by assumption) that the Concepto-level sections explicitly allow
 * multiple rows for the same Impuesto when TipoFactor differs, and the "solo un
 * registro" uniqueness language appears only in the Comprobante/Impuestos sections.
 */
export function impuestosTrasladosRetencionesUnicidad(parsed: ParsedCfdi): Finding[] {
  const findings: Finding[] = [];
  const impuestos = parsed.Impuestos;

  if (!impuestos) {
    return findings;
  }

  if (impuestos.Traslados) {
    const groups = new Map<string, ParsedCfdiTraslado[]>();
    for (const t of impuestos.Traslados.Traslado) {
      const key = JSON.stringify([t.Impuesto, t.TipoFactor, t.TasaOCuota ?? null]);
      const group = groups.get(key);
      if (group) {
        group.push(t);
      } else {
        groups.set(key, [t]);
      }
    }

    for (const group of groups.values()) {
      if (group.length > 1) {
        const [first] = group;
        findings.push({
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: {
            subcaso: "trasladoDuplicado",
            impuesto: first.Impuesto,
            tipoFactor: first.TipoFactor,
            tasaOCuota: first.TasaOCuota ?? null,
            ocurrencias: group.length,
            renglones: group,
          },
        });
      }
    }
  }

  if (impuestos.Retenciones) {
    const groups = new Map<string, ParsedCfdiRetencion[]>();
    for (const r of impuestos.Retenciones.Retencion) {
      const group = groups.get(r.Impuesto);
      if (group) {
        group.push(r);
      } else {
        groups.set(r.Impuesto, [r]);
      }
    }

    for (const [impuesto, group] of groups) {
      if (group.length > 1) {
        findings.push({
          ruleId: RULE_ID,
          fieldPath: FIELD_PATH,
          severity: SEVERITY,
          satReference: SAT_REFERENCE,
          evidence: {
            subcaso: "retencionDuplicada",
            impuesto,
            ocurrencias: group.length,
            renglones: group,
          },
        });
      }
    }
  }

  return findings;
}
