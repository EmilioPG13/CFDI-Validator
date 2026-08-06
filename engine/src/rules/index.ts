import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { SatCatalogs } from "../catalogs.ts";
import type { ConsultaCfdiResult } from "../../../sat-client/src/consultaCfdi.ts";
import type { EfosIndex } from "../../../sat-client/src/efosIndex.ts";
import { regimenUsoCompat } from "./regimenUsoCompat.ts";
import { domicilioFiscalReceptorCpExiste } from "./domicilioFiscalReceptorCpExiste.ts";
import { cfdiCanceladoSat } from "./cfdiCanceladoSat.ts";
import { emisorEfos69b } from "./emisorEfos69b.ts";
import { subtotalDescuentoConceptosSuma } from "./subtotalDescuentoConceptosSuma.ts";
import { totalComprobanteConsistencia } from "./totalComprobanteConsistencia.ts";
import { impuestosTotalesConsistencia } from "./impuestosTotalesConsistencia.ts";
import { monedaTipoCambioConsistencia } from "./monedaTipoCambioConsistencia.ts";
import { claveprodservClaveunidadVigente } from "./claveprodservClaveunidadVigente.ts";
import { tipodecomprobanteCamposProhibidos } from "./tipodecomprobanteCamposProhibidos.ts";
import { impuestosConceptoRollupConsistencia } from "./impuestosConceptoRollupConsistencia.ts";

/** The shape every rule in engine/rules/registry.json implements — see engine/src/finding.ts. */
export type Rule = (parsed: ParsedCfdi, catalogs: SatCatalogs) => Finding[];

/** All implemented rules, run in no particular order — each is independent per CLAUDE.md's
 *  "one rule, one function". Add new rules here as they're implemented. */
export const rules: Rule[] = [
  regimenUsoCompat,
  domicilioFiscalReceptorCpExiste,
  subtotalDescuentoConceptosSuma,
  totalComprobanteConsistencia,
  impuestosTotalesConsistencia,
  monedaTipoCambioConsistencia,
  claveprodservClaveunidadVigente,
  tipodecomprobanteCamposProhibidos,
  impuestosConceptoRollupConsistencia,
];

/**
 * `cfdi-cancelado-sat` and `emisor-efos-69b` don't fit `Rule`'s signature — they read
 * pre-fetched sat-client data (a live SAT lookup, a static 69-B index), not
 * catalogs.db, and forcing a shared type across genuinely different second-param
 * types would need a discriminated union for no real benefit yet. Kept as distinct,
 * separately-typed functions rather than shoehorned into one `allRules: unknown[]`
 * array; a caller wires each into the pipeline step it actually belongs to (see the
 * plan's architecture diagram — catalog rules, cancellation check, and 69-B match are
 * three separate pipeline steps, not one homogeneous rule list).
 */
export type SatCancellationRule = (parsed: ParsedCfdi, consultaResult: ConsultaCfdiResult) => Finding[];
export type EfosRule = (parsed: ParsedCfdi, efosIndex: EfosIndex) => Finding[];

export {
  regimenUsoCompat,
  domicilioFiscalReceptorCpExiste,
  cfdiCanceladoSat,
  emisorEfos69b,
  subtotalDescuentoConceptosSuma,
  totalComprobanteConsistencia,
  impuestosTotalesConsistencia,
  monedaTipoCambioConsistencia,
  claveprodservClaveunidadVigente,
  tipodecomprobanteCamposProhibidos,
  impuestosConceptoRollupConsistencia,
};
