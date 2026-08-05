import type { Finding } from "../finding.ts";
import type { ParsedCfdi } from "../parse.ts";
import type { SatCatalogs } from "../catalogs.ts";
import { regimenUsoCompat } from "./regimenUsoCompat.ts";
import { domicilioFiscalReceptorCpExiste } from "./domicilioFiscalReceptorCpExiste.ts";

/** The shape every rule in engine/rules/registry.json implements — see engine/src/finding.ts. */
export type Rule = (parsed: ParsedCfdi, catalogs: SatCatalogs) => Finding[];

/** All implemented rules, run in no particular order — each is independent per CLAUDE.md's
 *  "one rule, one function". Add new rules here as they're implemented. */
export const rules: Rule[] = [regimenUsoCompat, domicilioFiscalReceptorCpExiste];

export { regimenUsoCompat, domicilioFiscalReceptorCpExiste };
