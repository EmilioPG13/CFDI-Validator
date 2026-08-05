import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { EfosIndex, EfosSituacion } from "../../../sat-client/src/efosIndex.ts";

// Verbatim from engine/rules/registry.json, ruleId "emisor-efos-69b" — do not
// paraphrase; if this ever looks wrong, flag it back to cfdi-domain rather than
// editing it here (see engine/CLAUDE.md's "satReference is copied, not paraphrased").
const RULE_ID = "emisor-efos-69b";
const FIELD_PATH =
  "No es un campo del XML: es el resultado de sat-client EfosIndex.lookup(rfc) (EfosRecord.situacion) para Comprobante/Emisor/@Rfc, contra un índice en memoria cargado de corpus/efos/listado_completo_69b.csv (lista estática descargada, no una consulta en vivo — a diferencia de la regla 'cfdi-cancelado-sat').";
// Independently re-verified 2026-08-05, before writing this function: the
// "no producen ni produjeron efecto fiscal alguno" sentence below was cross-checked
// against two additional, freshly-run searches (independent of cfdi-domain's own
// sourcing) and reproduces verbatim in both. The Art. 29-A cancellation-deadline text
// in cfdiCanceladoSat.ts's SAT_REFERENCE was verified the same way. Recorded here as a
// code comment, not folded into SAT_REFERENCE itself — that string is copied verbatim
// from the registry spec and stays that way; this note documents the verification
// step, it isn't part of the citation.
const SAT_REFERENCE =
  "CFF Art. 69-B. Texto verificado y cruzado en múltiples fuentes de segunda mano (mley.mx/CFF/articulo/69-b/, corroborado por idconline.mx, blog.cjaduanero.com, stratego-st.com — no se pudo renderizar el PDF oficial de diputados.gob.mx localmente para contar párrafos contra el original, falta poppler-utils en este entorno). Etapa 'Presunto', primer párrafo: 'Cuando la autoridad fiscal detecte que un contribuyente ha estado emitiendo comprobantes sin contar con los activos, personal, infraestructura o capacidad material, directa o indirectamente, para prestar los servicios o producir, comercializar o entregar los bienes que amparan tales comprobantes, o bien, que dichos contribuyentes se encuentren no localizados, se presumirá la inexistencia de las operaciones amparadas en tales comprobantes.' Etapa 'Definitivo' — el párrafo que ordena publicar en el DOF el listado de quienes NO desvirtuaron y fija el efecto (numerado 'cuarto párrafo' en la fuente consultada, ver flag de incertidumbre abajo): 'Los efectos de la publicación de este listado serán considerar, con efectos generales, que las operaciones contenidas en los comprobantes fiscales expedidos por el contribuyente en cuestión no producen ni produjeron efecto fiscal alguno.' Esta es la frase que sostiene severity=error para 'Definitivo': es un efecto general y retroactivo, no limitado a las operaciones originalmente cuestionadas. Etapas 'Desvirtuado' / 'Sentencia Favorable' — un párrafo posterior (numerado 'quinto' en una fuente consultada y 'sexto' en otra; incertidumbre de numeración, no de contenido) ordena publicar trimestralmente un listado de quienes 'logren desvirtuar los hechos que se les imputan' (Desvirtuado) y de quienes 'obtuvieron resolución o sentencia firmes que hayan dejado sin efectos la resolución' (Sentencia Favorable) — es decir, el propio SAT (Desvirtuado) o un tribunal (Sentencia Favorable) revirtieron la presunción. Flag de incertidumbre explícito: el número de artículo (69-B) y cada frase citada arriba están corroborados en ≥2 fuentes independientes cada una, pero la numeración exacta de párrafo (segundo/tercero/cuarto/quinto/sexto) varía entre las fuentes de segunda mano consultadas — posiblemente por las reformas que ha sufrido este artículo (p.ej. DOF 2018-06-25) o por imprecisión de los resúmenes automatizados usados en esta investigación. Confirmar la numeración exacta de párrafo contra el texto vigente en el DOF antes de citarla en un reporte formal o legal; el artículo y el contenido citado sí son fiables para fundamentar el finding.";

/**
 * Definitivo → error (CFF: efectos fiscales nulos con carácter general).
 * Presunto → warning (investigación en curso, no una determinación firme).
 * Desvirtuado / Sentencia Favorable → no Finding at all (see this file's own
 * comment below, and the spec's notes, for why a third severity tier isn't
 * invented here to give these a trace).
 */
const SEVERITY_BY_SITUACION: Partial<Record<EfosSituacion, Finding["severity"]>> = {
  Definitivo: "error",
  Presunto: "warning",
};

/**
 * ruleId: emisor-efos-69b (engine/rules/registry.json).
 *
 * Pure lookup — `efosIndex` must already be loaded (EfosIndex reads
 * corpus/efos/listado_completo_69b.csv synchronously at construction; loading it once
 * per batch, not per-CFDI, is the caller's job).
 *
 * "Desvirtuado" and "Sentencia Favorable" deliberately produce no Finding: the spec's
 * notes explain at length why forcing them into "error" or "warning" would be
 * factually wrong (the SAT or a court already concluded there's no basis for the
 * suspicion), and engine/src/finding.ts's Finding.severity is a strict
 * "error" | "warning" union with no "info" tier — introducing one is a Finding
 * contract change affecting every rule and the future Explainer/Verifier, not a
 * decision to make unilaterally inside one rule function.
 *
 * A lookup() miss (RFC not on the list) also produces no Finding, and must NOT be
 * read as "clean" — see EfosIndexMeta.informacionActualizadaAl, always attached as
 * evidence when a Finding *does* fire, precisely so nothing downstream can present a
 * result from this rule without the staleness date attached.
 */
export function emisorEfos69b(parsed: ParsedCfdi, efosIndex: EfosIndex): Finding[] {
  const record = efosIndex.lookup(parsed.Emisor.Rfc);
  if (!record) {
    return [];
  }

  const severity = SEVERITY_BY_SITUACION[record.situacion];
  if (!severity) {
    return [];
  }

  return [
    {
      ruleId: RULE_ID,
      fieldPath: FIELD_PATH,
      severity,
      satReference: SAT_REFERENCE,
      evidence: {
        rfcEmisor: parsed.Emisor.Rfc,
        situacion: record.situacion,
        nombreContribuyente: record.nombreContribuyente,
        raw: record.raw,
        informacionActualizadaAl: efosIndex.meta.informacionActualizadaAl,
      },
    },
  ];
}
