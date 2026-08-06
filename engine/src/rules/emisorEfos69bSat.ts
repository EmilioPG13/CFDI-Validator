import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { ConsultaCfdiResult } from "../../../sat-client/src/consultaCfdi.ts";

// Verbatim from engine/rules/registry.json, ruleId "emisor-efos-69b-sat" — do not
// paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "emisor-efos-69b-sat";
const FIELD_PATH =
  "No es un campo del XML: es el resultado de sat-client ConsultaCfdiClient.consulta() (ConsultaCfdiResult.efosEmisorEncontrado — sat-client/src/consultaCfdi.ts, interpretEfosEmisorEncontrado()) para el UUID en Comprobante/Complemento/TimbreFiscalDigital/@UUID, consultado junto con Comprobante/Emisor/@Rfc, Comprobante/Receptor/@Rfc y Comprobante/@Total — los mismos cuatro parámetros que 'cfdi-cancelado-sat' ya usa. Esta es LITERALMENTE LA MISMA llamada SOAP en vivo que 'cfdi-cancelado-sat' ya hace por cada UUID: el campo ValidacionEFOS viaja en la misma respuesta 'Acuse' que trae Estado (de donde 'cfdi-cancelado-sat' deriva cancelado/vigente) — implementar esta regla no añade ninguna llamada de red nueva, solo lee un campo distinto del mismo ConsultaCfdiResult que el pipeline ya obtiene.";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "SAT, \"Documentación del Servicio de Consulta de CFDI\", Versión 1.4, Fecha: Noviembre 2022, http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Documentacion_WS_Consulta_CFDI_v1.4.pdf — fuente PRIMARIA oficial del SAT (no un blog de segunda mano), verificada de forma independiente esta sesión: descargada de nuevo por HTTP plano (per el gotcha de TLS de omawww.sat.gob.mx ya documentado en CLAUDE.md) y extraída con `pdftotext -layout`, re-derivando el mapeo de códigos directamente del PDF en vez de confiar en el resumen del comentario de cabecera de consultaCfdi.ts — ambos coinciden exactamente. Sección 3 \"Mensajes de Respuesta\" › subsección \"Mensajes de validación del RFC Emisor\": código 100 (p. 10) — \"Este código de respuesta se presentará cuando la validación del RFC Emisor del CFDI se encuentre dentro de la lista de Empresa que Factura Operaciones Simuladas (EFOS)... El emisor de la factura verificada se encuentra publicado en la lista de empresas que facturan operaciones simuladas de conformidad con los párrafos primero al quinto del Artículo 69-B del CFF. Consulta aquí la fecha en que se publicó la empresa en el listado de definitivas.\"; código 101 (p. 12) — mismo texto, más un RFC a cuenta de terceros también encontrado; código 104 (p. 14) — mismo texto que 101; los tres (100/101/104) citan explícitamente \"el listado de definitivas\" y el mismo rango de párrafos del Art. 69-B, confirmando que es la MISMA etapa \"Definitivo\" (no \"Presunto\") que 'emisor-efos-69b' ya trata como severity 'error' en su propia rama Definitivo — mismo hecho legal, dos fuentes de datos. Código 102 (p. 12) y 103 (p. 13) — el RFC Emisor específicamente NO se encuentra en la lista (\"la validación del RFC Emisor del CFDI no se encuentre dentro de la lista de Empresa que Factura Operaciones Simuladas (EFOS)\"), aunque un RFC \"a cuenta de terceros\" relacionado sí fue encontrado — ese RFC de terceros no se parsea de la CFDI XML en este proyecto (fuera de alcance, mismo razonamiento que el comentario de cabecera de consultaCfdi.ts), así que 102/103 se agrupan con el caso simple de 'no encontrado'. Código 200 (p. 14) y 201 (p. 15) — el RFC Emisor no se encuentra en la lista, caso simple sin RFC de terceros. CORRECCIÓN DE PRECISIÓN DE CITA, verificada por el orquestador de forma independiente del propio spec de esta regla (no solo re-derivada una vez, sino confirmada una segunda vez contando saltos de página \\f de pdftotext directamente, página por página, no por inferencia del índice del documento): el comentario de cabecera de sat-client/src/consultaCfdi.ts cita esta subsección como \"p. 10-14\"; el conteo físico de páginas ubica código 100 en p. 10, 101 y 102 en p. 12, 103 en p. 13, 104 y 200 en p. 14 (comparten página), y 201 en p. 15 — la subsección completa \"Mensajes de validación del RFC Emisor\" ocupa p. 10-15, no p. 10-14. Diferencia de una página en el límite superior del rango, no afecta el contenido ni la semántica de ningún código citado arriba; se señala aquí por disciplina de citación exacta y como corrección menor sugerida para el comentario de consultaCfdi.ts, no porque cambie ninguna conclusión de esta regla. Fundamento del efecto fiscal (compartido con 'emisor-efos-69b', no re-investigado desde cero esta sesión): CFF Art. 69-B, ver satReference completo de 'emisor-efos-69b' para el texto de la etapa Definitivo y su nivel de corroboración — el propio PDF de ConsultaCFDIService aquí citado añade una corroboración PRIMARIA adicional sobre qué párrafos de 69-B rigen la publicación (\"primero al quinto\"), consistente con, y no contradictoria a, la numeración de \"cuarto párrafo\" que esa regla ya marca como incierta entre fuentes secundarias.";

/**
 * ruleId: emisor-efos-69b-sat (engine/rules/registry.json).
 *
 * Pure mapper — does NOT call the network. `consultaResult` must already be fetched
 * via sat-client's ConsultaCfdiClient, the SAME call 'cfdi-cancelado-sat' already makes
 * for this UUID (ValidacionEFOS rides in the same "Acuse" SOAP response as Estado) —
 * this function adds no new network call, it just reads a different field off the
 * already-fetched ConsultaCfdiResult. Reuses SatCancellationRule's signature
 * (engine/src/rules/index.ts) rather than inventing a new type, per the spec's own
 * "source" field.
 *
 * Three-way outcome per the spec's condition (steps 2-4), deliberately not collapsed
 * to a boolean — mirrors how cfdiCanceladoSat.ts handles its own analogous nullable
 * field without collapsing states:
 *   - found === false → SAT has no record of this UUID at all. No Finding — and NOT
 *     treated as "Emisor not on the EFOS list" either; a caller building a report needs
 *     to surface "unverified" separately (this function's return type can't express
 *     that distinction).
 *   - efosEmisorEncontrado === true → the actual Finding. Same legal fact (Definitivo,
 *     CFF Art. 69-B) as emisor-efos-69b's Definitivo branch, sourced live instead of
 *     from the static CSV.
 *   - efosEmisorEncontrado === false → SAT specifically confirmed this Emisor RFC is
 *     NOT on the Definitivo list right now (ValidacionEFOS codes 102/103/200/201). A
 *     stronger signal than emisor-efos-69b's silence, but still not "clean of EFOS
 *     risk" — ValidacionEFOS has no code for "Presunto", "Desvirtuado", or "Sentencia
 *     Favorable" (see the spec's notes). No Finding.
 *   - efosEmisorEncontrado === null → Estado/ValidacionEFOS came back but wasn't
 *     recognized as any documented code (or the UUID wasn't found at all). Not the
 *     same as "false" — a third, distinct "couldn't determine" state. No Finding, but
 *     also not a pass.
 *
 * Per the spec's condition step 5: this rule is fully independent of cfdiCanceladoSat
 * — a CFDI can be Vigente while its Emisor sits on the EFOS Definitivo list at the same
 * time (two distinct legal questions about the same comprobante). Both rules must
 * always be evaluated against the same ConsultaCfdiResult, never short-circuited by
 * the other's outcome — this function does not look at consultaResult.cancelado/
 * vigente at all, only at efosEmisorEncontrado.
 */
export function emisorEfos69bSat(parsed: ParsedCfdi, consultaResult: ConsultaCfdiResult): Finding[] {
  if (!consultaResult.found || consultaResult.efosEmisorEncontrado !== true) {
    return [];
  }

  return [
    {
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity: SEVERITY,
      satReference: SAT_REFERENCE,
      evidence: {
        uuid: parsed.Complemento?.TimbreFiscalDigital?.UUID,
        rfcEmisor: parsed.Emisor.Rfc,
        rfcReceptor: parsed.Receptor.Rfc,
        total: parsed.Total,
        raw: consultaResult.raw,
        consultadoEl: new Date().toISOString(),
      },
    },
  ];
}
