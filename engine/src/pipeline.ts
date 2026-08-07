import type { XsdValidator } from "libxml2-wasm";
import type { Finding } from "./finding.ts";
import { parseCfdi, type ParsedCfdi } from "./parse.ts";
import type { CatalogSource } from "./catalogTypes.ts";
import { validateXmlBrowser } from "./xsdBrowser.ts";
import { rules, cfdiCanceladoSat, emisorEfos69b, emisorEfos69bSat } from "./rules/index.ts";
import type { EfosIndex } from "../../sat-client/src/efosIndex.ts";
import type { ConsultaCfdiParams, ConsultaCfdiResult } from "../../sat-client/src/consultaCfdi.ts";

/**
 * Ties parse → XSD validate → rule evaluation together for ONE CFDI XML document — the
 * "Browser (WASM, local)" column of the project plan's architecture diagram, minus the
 * ZIP-unzipping step (deliberately out of scope here: that's a frontend concern involving
 * a zip library, not something engine/ — which stays pure, no I/O beyond what's injected —
 * should own; a caller loops this function over unzipped entries).
 *
 * Built entirely from the environment-agnostic pieces already proven in isolation this
 * phase: `CatalogSource` (SatCatalogs OR BrowserCatalogs — this file doesn't know or care
 * which), `xsdBrowser.ts`'s `validateXmlBrowser` (works identically in Node or a real
 * browser — see that file's own header comment on why it has zero Node-specific imports
 * despite the name), and the `rules: Rule[]` array (already typed against `CatalogSource`,
 * Phase 4a). Nothing new is invented here — this module is deliberately "just wiring".
 */

export interface PipelineDeps {
  catalogs: CatalogSource;
  /** Already compiled — see xsdBrowser.ts's `loadCfdiValidatorWithComplementsBrowser` (or
   *  xsd.ts's Node equivalent; either works, a compiled XsdValidator is just a WASM handle
   *  regardless of how its schema bytes were loaded). */
  xsdValidator: XsdValidator;
  /** Static 69-B/EFOS index — omit to skip `emisor-efos-69b` entirely (e.g. it hasn't been
   *  loaded yet, or a caller deliberately wants a catalog-only pass). */
  efosIndex?: EfosIndex;
  /**
   * Performs the live SAT `ConsultaCFDIService` call for one UUID — injected, not called
   * directly, because engine/ has no network I/O of its own (CLAUDE.md's core boundary)
   * and because the browser can't call SAT directly at all (no CORS — confirmed live this
   * session; a caller's implementation of this function is expected to go through the
   * Phase 4d proxy). Omit to skip `cfdi-cancelado-sat`/`emisor-efos-69b-sat` entirely —
   * e.g. an offline demo, or the proxy being temporarily unavailable. Rate limiting/retry
   * belong to whatever implementation is passed in (sat-client's `ConsultaCfdiClient`
   * already has both) — this module calls it once per document and does not retry itself.
   */
  consultaSat?: (params: ConsultaCfdiParams) => Promise<ConsultaCfdiResult>;
}

export interface CfdiAuditResult {
  xsdValid: boolean;
  xsdErrors: string[];
  /** Every Finding from every rule that ran — catalog rules always run; efosIndex/
   *  consultaSat-backed rules run only if those deps were provided. Empty (not omitted)
   *  when xsdValid is false or parseError is set — there's nothing to evaluate rules
   *  against in either case. */
  findings: Finding[];
  /** Set when the document fails XSD validation OR is XSD-valid but parseCfdi still can't
   *  make sense of it (shouldn't normally happen if XSD passed, but a rule engine must
   *  never crash on a real uploaded file — surfaced as data, not an uncaught exception). */
  parseError?: string;
  /**
   * True when `consultaSat` was provided but this document's SAT-live rules could NOT be
   * evaluated — either the call itself failed (network/timeout/proxy down) or the document
   * has no TimbreFiscalDigital/UUID to query with at all. Mirrors `cfdi-cancelado-sat` and
   * `emisor-efos-69b-sat`'s own "found=false / null ⇒ don't claim clean" philosophy one
   * level up: a caller MUST surface this as "not verified", never silently read an absence
   * of cfdi-cancelado-sat/emisor-efos-69b-sat findings as "this document is fine".
   */
  satUnverified?: boolean;
}

export async function auditCfdiXml(xmlBytes: Uint8Array, deps: PipelineDeps): Promise<CfdiAuditResult> {
  const xsd = validateXmlBrowser(deps.xsdValidator, xmlBytes);
  if (!xsd.valid) {
    return { xsdValid: false, xsdErrors: xsd.errors, findings: [] };
  }

  let parsed: ParsedCfdi;
  try {
    // parseCfdi accepts Uint8Array directly (widened in this same phase, for this same
    // reason — see parse.ts's own comment on why it no longer types this as Buffer).
    parsed = parseCfdi(xmlBytes);
  } catch (err) {
    return {
      xsdValid: true,
      xsdErrors: [],
      findings: [],
      parseError: err instanceof Error ? err.message : String(err),
    };
  }

  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...rule(parsed, deps.catalogs));
  }

  if (deps.efosIndex) {
    findings.push(...emisorEfos69b(parsed, deps.efosIndex));
  }

  let satUnverified: boolean | undefined;
  if (deps.consultaSat) {
    const uuid = parsed.Complemento?.TimbreFiscalDigital?.UUID;
    if (!uuid) {
      // No TFD complement at all -- XSD-valid CFDIs without one are legal per the schema
      // (CLAUDE.md's own gotcha: cfdv40.xsd alone allows it) but there's no UUID to query
      // ConsultaCFDIService with, so the SAT-live rules simply can't run for this document.
      satUnverified = true;
    } else {
      try {
        const result = await deps.consultaSat({
          rfcEmisor: parsed.Emisor.Rfc,
          rfcReceptor: parsed.Receptor.Rfc,
          total: parsed.Total,
          uuid,
        });
        findings.push(...cfdiCanceladoSat(parsed, result));
        findings.push(...emisorEfos69bSat(parsed, result));
      } catch {
        satUnverified = true;
      }
    }
  }

  return { xsdValid: true, xsdErrors: [], findings, satUnverified };
}
