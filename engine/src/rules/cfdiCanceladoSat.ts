import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { ConsultaCfdiResult } from "../../../sat-client/src/consultaCfdi.ts";

// Verbatim from engine/rules/registry.json, ruleId "cfdi-cancelado-sat" — do not
// paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "cfdi-cancelado-sat";
const FIELD_PATH =
  "No es un campo del XML: es el resultado de sat-client ConsultaCfdiClient.consulta() (ConsultaCfdiResult.cancelado) para el UUID en Comprobante/Complemento/TimbreFiscalDigital/@UUID, consultado junto con Comprobante/Emisor/@Rfc, Comprobante/Receptor/@Rfc y Comprobante/@Total (los cuatro parámetros que ConsultaCfdiParams exige, tomados del propio XML pero evaluados contra un servicio SAT en vivo, no contra el XML ni contra catalogs.db).";
const SEVERITY: Finding["severity"] = "error";
const SAT_REFERENCE =
  "CFF Art. 29-A. Texto verificado y cruzado en 3 fuentes independientes de segunda mano (mley.mx/CFF/articulo/29-a/, leyesmx.com/cff/articulo/29-A/, gncys.com/normatividad/cff/cff-articulo-29-a.aspx — no se pudo renderizar el PDF oficial diputados.gob.mx/LeyesBiblio/pdf/CFF.pdf localmente, falta poppler-utils/pdftoppm en este entorno, así que la verificación es contra fuentes secundarias que reproducen el texto, no contra el original en PDF directamente): 'Los comprobantes fiscales digitales por Internet se podrán cancelar a más tardar en el mes en el cual se deba presentar la declaración anual del impuesto sobre la renta que corresponda al ejercicio fiscal en el cual se expidió el referido comprobante y siempre que la persona a favor de quien se expidan acepte su cancelación.' El párrafo siguiente delega en el SAT, vía reglas de carácter general, la forma de manifestar esa aceptación — implementado en la RMF vigente (2026) como reglas 2.7.1.34 (Aceptación del receptor para la cancelación del CFDI) y 2.7.1.35 (Cancelación de CFDI sin aceptación del receptor); numeración corroborada en 2 fuentes independientes para RMF 2026 (idnube.com/blog/cancelacion-cfdi-rmf-2026-aceptacion-obligatoria y una segunda búsqueda que cita la misma numeración), pero el propio dominio wwwmat.sat.gob.mx expone una de esas reglas bajo la URL '/articulo/62770/regla-2.7.1.39', lo que sugiere que en ejercicios anteriores estas mismas reglas tenían otra numeración (2.7.1.38/2.7.1.39) — confirmar la numeración vigente al momento de correr la auditoría, no asumir que 2.7.1.34/2.7.1.35 es estable año con año. El efecto sobre la deducción del RECEPTOR se arma encadenando: LISR Art. 27, fracción III ('estar amparadas con un comprobante fiscal...') y fracción XVIII (el comprobante debe obtenerse a más tardar el día en que se deba presentar la declaración) — ambas verificadas contra wwwmat.sat.gob.mx/articulo/05481/articulo-27. Flag de honestidad: NO se localizó una sola frase del CFF que diga literalmente 'un comprobante cancelado no es deducible'; la conclusión de que un CFDI con Estado=Cancelado deja de ser el 'comprobante fiscal' vigente que el Art. 27 LISR exige es la lectura estándar y consistente de la práctica fiscal mexicana (contadormx.com, IDC, KPMG, entre otras fuentes consultadas coinciden en esto), construida sobre las disposiciones citadas — no una única cita textual aislada. Tratar esto como razonablemente bien fundado pero como una cadena de inferencia, no como una sola oración citable.";

/**
 * ruleId: cfdi-cancelado-sat (engine/rules/registry.json).
 *
 * Pure mapper — does NOT call the network. `consultaResult` must already be fetched
 * via sat-client's ConsultaCfdiClient (rate-limited, retried, timed-out there). This
 * function only decides what a given result means for the Finding[] contract.
 *
 * Three-way outcome per the spec's condition (steps 3-5), deliberately not collapsed
 * to a boolean:
 *   - found === false  → SAT has no record of this exact (re, rr, tt, id) combination.
 *     Could be a formatting mismatch in any of the 4 params, not necessarily a fake
 *     invoice. No Finding — and NOT silently treated as "not cancelled" either; a
 *     caller building a report needs to surface "unverified" separately (see the
 *     spec's notes — this function's return type can't express that distinction yet).
 *   - cancelado === true → the actual Finding.
 *   - cancelado === null → Estado came back but wasn't recognized as exactly
 *     "Vigente" or "Cancelado" (see ConsultaCfdiResult's own doc comment on why this
 *     is nullable). Not the same as "not cancelled" — no Finding, but also not a pass.
 */
export function cfdiCanceladoSat(parsed: ParsedCfdi, consultaResult: ConsultaCfdiResult): Finding[] {
  if (!consultaResult.found || consultaResult.cancelado !== true) {
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
        raw: consultaResult.raw,
        consultadoEl: new Date().toISOString(),
      },
    },
  ];
}
