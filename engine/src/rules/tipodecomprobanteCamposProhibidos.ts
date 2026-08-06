import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";

// Verbatim from engine/rules/registry.json, ruleId "tipodecomprobante-campos-prohibidos" —
// do not paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "tipodecomprobante-campos-prohibidos";
const FIELD_PATH =
  "Comprobante/@CondicionesDePago; Comprobante/Conceptos/Concepto/@Descuento; Comprobante/@Descuento; Comprobante/Impuestos (nodo, existencia); Comprobante/@FormaPago; Comprobante/@MetodoPago — los seis validados contra Comprobante/@TipoDeComprobante";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "Anexo 20 Guía de llenado CFDI v4.0, campo TipoDeComprobante, p. 11/123 (el encabezado del campo aparece inmediatamente después del pie de página \"10 / 123\"; texto extraído independientemente en esta sesión de corpus/anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf vía \"pdftotext -layout -f 9 -l 12\" y corroborado además con \"pdftotext -raw\" para descartar artefactos de columnas — ambos modos de extracción devuelven el mismo texto): \"No debe existir el campo CondicionesDePago cuando el campo TipoDeComprobante es 'T' (Traslado), 'P' (Pago) o 'N' (Nómina). No debe existir el campo Descuento de los conceptos cuando el campo TipoDeComprobante es 'T' (Traslado) o 'P' (Pago). No debe existir el nodo Impuestos cuando el campo TipoDeComprobante es 'T' (Traslado), 'P' (Pago) o 'N' (Nómina). No debe existir el campo FormaPago cuando el campo TipoDeComprobante es 'N' (Nómina). No deben existir los campos FormaPago y MetodoPago cuando el campo TipoDeComprobante es 'T' (Traslado) o 'P' (Pago).\" Nota de fidelidad de extracción: inmediatamente después de la última viñeta citada, el PDF trae un sexto marcador de viñeta \"•\" sin texto asociado antes de saltar a la sección \"Exportacion\" — confirmado en ambos modos de extracción (-layout y -raw), así que es un artefacto del documento original (viñeta vacía / residual de formato), no una omisión de esta extracción; no hay una sexta regla oculta detrás de ese marcador. La rama de Comprobante/@Descuento (a nivel de encabezado, no del Concepto) se apoya en un pasaje distinto, ya citado en extenso por subtotal-descuento-conceptos-suma: Anexo 20, campo SubTotal/Descuento, p. 8-9/123: \"...en otro caso se debe omitir este campo\" — aplicado aquí específicamente a la rama TipoDeComprobante ∈ {T,P}, que esa regla identifica en su propio \"condition\" (paso 1) pero deja explícitamente fuera de alcance (\"fuera del alcance aritmético de esta regla — ver notes\") y que su nota 4 señala como candidata para un batch futuro; esta regla es ese batch futuro. Códigos oficiales de rechazo CFDI40 confirmados esta sesión, cada uno verificado en ≥2 fuentes independientes salvo donde se indica lo contrario: CFDI40103 (FormaPago, T/N/P) — \"Si existe el tipo de comprobante T, N o P el campo FormaPago no debe existir\" (gncys.com/anexo20/4.0/errores/CFDI40103/, contadormx.net vía búsqueda cruzada); CFDI40125 (MetodoPago, T/P) — \"Se debe omitir el campo MetodoPago cuando el TipoDeComprobante es T o P\" (gncys.com/anexo20/4.0/errores/CFDI40125/); CFDI40201 (Impuestos, SOLO T/P) — \"Cuando el TipoDeComprobante sea T o P, el elemento Impuestos no debe existir\" (gncys.com/anexo20/4.0/errores/CFDI40201/); CFDI40111 (Descuento de Concepto, TipoDeComprobante∉{I,E,N} ⟺ T/P, equivalencia confirmada por separado vía catalogs.db tabla cfdi_40_tipos_comprobantes — exactamente 5 valores I/E/T/N/P vigentes, consultada directamente esta sesión) — \"El TipoDeComprobante no es I,E o N, y un concepto incluye el campo descuento\" (gncys.com/anexo20/4.0/errores/CFDI40111/, blog.misolucionaqui.com — el texto de este código YA estaba citado en subtotal-descuento-conceptos-suma, pero solo como corroboración de la redacción del Anexo 20 sobre la aritmética de Descuento; esa regla nunca lo implementa como condición para la rama T/P, ver su propio \"condition\" paso 1 — \"No seguir a los pasos 2-3 para este caso\" — así que esta es la primera vez que CFDI40111 se usa como fundamento operativo real de un Finding). DOS FLAGS DE INCERTIDUMBRE EXPLÍCITOS, no smoothed: (a) CondicionesDePago — se buscó activamente un código CFDI40 dedicado (satfacil.com.mx/errores-sat, el índice de ~93 códigos de gncys.com/anexo20/4.0/errores/, búsquedas específicas por el texto exacto de la viñeta) y NO se encontró ninguno; ningún CFDI40xxx catalogado por esas fuentes menciona CondicionesDePago. La viñeta del Anexo 20 en sí (idéntica en formato e imperativo normativo a las otras cuatro que sí tienen código confirmado, dentro de la misma lista numerada de la misma página) se trata como satReference suficiente por sí sola — es una cita primaria directa, no una inferencia — pero se marca aquí para que quien audite esta regla sepa que la ausencia de un código de rechazo catalogado por terceros no fue pasada por alto, se buscó y no se encontró. (b) Impuestos para TipoDeComprobante='N' — el Anexo 20 agrupa T, P y N en una sola viñeta (\"...T, P o N\"), pero el mensaje verbatim de CFDI40201 confirmado en dos fuentes independientes dice explícitamente \"Cuando el TipoDeComprobante sea T o P\" — SIN mencionar N. Se buscó activamente un código específico para la rama N (incluyendo la matriz de errores de Nómina en fiscalcloud.mx y reachcore.com) y no se encontró ninguno dedicado a la ausencia del nodo Impuestos a nivel Comprobante para Nómina. La regla en sí sigue bien fundada por la cita primaria del Anexo 20 (que sí agrupa las tres), pero el cruce con un código de rechazo específico solo está confirmado para T/P, no para N — tratar el sub-caso N como \"solo-fuente-primaria\", un peldaño de citación por debajo de los otros cuatro sub-casos de esta misma regla. Nota adicional de higiene de investigación: una recolección de sesión anterior sugería que CFDI40105 era relevante a esta familia de reglas de presencia condicional por TipoDeComprobante — se verificó independientemente y es INCORRECTO: CFDI40105 (\"El campo FormaPago no contiene el valor '99'\") es una regla completamente distinta (FormaPago debe ser \"99\" cuando MetodoPago es \"PPD\", verificado en ≥3 fuentes independientes: facturacioncfdimexico.blogspot.com, soicont.com.mx, blog.misolucionaqui.com), sin relación con la ausencia/presencia de campos por TipoDeComprobante — no reutilizar esa cita para esta regla.";

/**
 * ruleId: tipodecomprobante-campos-prohibidos (engine/rules/registry.json).
 *
 * Six independent sub-cases, each individually gated on TipoDeComprobante and each
 * capable of producing its own Finding (a single comprobante can trigger several at
 * once — registry.json's condition: "no colapsarlos"):
 *
 *   1. CondicionesDePago present, tipo ∈ {T,P,N}
 *   2. Concepto/@Descuento present, tipo ∈ {T,P} (one Finding per offending Concepto)
 *   3. Comprobante/@Descuento present, tipo ∈ {T,P}
 *   4. Comprobante/Impuestos node present, tipo ∈ {T,P,N}
 *   5. Comprobante/@FormaPago present, tipo ∈ {T,N,P}
 *   6. Comprobante/@MetodoPago present, tipo ∈ {T,P}
 *
 * TipoDeComprobante ∈ {I,E} never satisfies any of these six gates, so nothing is
 * evaluated for it — no special-casing needed beyond the gates themselves. Likewise
 * tipo="N" only ever matches gates 1, 4, and 5 (gates 2, 3, 6 are all {T,P}-only) —
 * this falls out of the individual gates as specified, not from extra logic.
 */
export function tipodecomprobanteCamposProhibidos(parsed: ParsedCfdi): Finding[] {
  const tipo = parsed.TipoDeComprobante;
  const findings: Finding[] = [];

  const push = (evidence: unknown) => {
    findings.push({
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence,
    });
  };

  // 1. CondicionesDePago — T, P, N.
  if ((tipo === "T" || tipo === "P" || tipo === "N") && parsed.CondicionesDePago !== undefined) {
    push({ subcaso: "condicionesDePago", tipo });
  }

  // 2. Concepto/@Descuento — T, P only (CFDI40111).
  if (tipo === "T" || tipo === "P") {
    parsed.Conceptos.Concepto.forEach((concepto, conceptoIndex) => {
      if (concepto.Descuento !== undefined) {
        push({ subcaso: "conceptoDescuento", tipo, conceptoIndex });
      }
    });
  }

  // 3. Comprobante/@Descuento — T, P only.
  if ((tipo === "T" || tipo === "P") && parsed.Descuento !== undefined) {
    push({ subcaso: "comprobanteDescuento", tipo });
  }

  // 4. Comprobante/Impuestos node — T, P, N (CFDI40201 confirmed only for T/P).
  if ((tipo === "T" || tipo === "P" || tipo === "N") && parsed.Impuestos !== undefined) {
    push({ subcaso: "impuestosNodo", tipo });
  }

  // 5. Comprobante/@FormaPago — T, N, P (CFDI40103).
  if ((tipo === "T" || tipo === "N" || tipo === "P") && parsed.FormaPago !== undefined) {
    push({ subcaso: "formaPago", tipo });
  }

  // 6. Comprobante/@MetodoPago — T, P only (CFDI40125).
  if ((tipo === "T" || tipo === "P") && parsed.MetodoPago !== undefined) {
    push({ subcaso: "metodoPago", tipo });
  }

  return findings;
}
