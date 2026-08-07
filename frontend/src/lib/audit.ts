import {
  registerXsdTreeBuffers,
  loadCfdiValidatorWithComplementsBrowser,
  XSD_TREE_FILES,
  type XsdTreeBuffers,
} from "../../../engine/src/xsdBrowser.ts";
import { BrowserCatalogs, type CatalogBundle } from "../../../engine/src/catalogsBrowser.ts";
import { auditCfdiXml, type CfdiAuditResult, type PipelineDeps } from "../../../engine/src/pipeline.ts";
import { EfosIndex } from "../../../sat-client/src/efosIndex.ts";
import type { ConsultaCfdiParams, ConsultaCfdiResult } from "../../../sat-client/src/consultaCfdi.ts";

export type { CfdiAuditResult } from "../../../engine/src/pipeline.ts";

/**
 * The browser-side wiring for engine/src/pipeline.ts — fetches the static assets
 * scripts/sync-static-assets.mjs copies into public/ (XSD tree, catalog bundle, 69-B
 * CSV) and builds a `PipelineDeps` the exact same way engine/test/pipeline.test.ts
 * already proved works end-to-end (Phase 4c), just sourced via `fetch()` here instead
 * of `node:fs`. `consultaSat` calls THIS deployment's own `/api/consulta-sat` proxy
 * (Phase 4d) — never SAT directly; the browser can't (no CORS, confirmed live in 4a).
 *
 * Every catalog rule + XSD validation works with zero network access at all once these
 * assets are cached (they're static files, browser-cacheable); only the two SAT-live
 * rules need `/api/consulta-sat` reachable at call time.
 */

const CATALOG_TABLES = [
  "cfdi_40_monedas",
  "cfdi_40_codigos_postales",
  "cfdi_40_usos_cfdi",
  "cfdi_40_productos_servicios",
  "cfdi_40_claves_unidades",
] as const;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function consultaSat(params: ConsultaCfdiParams): Promise<ConsultaCfdiResult> {
  const res = await fetch("/api/consulta-sat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `consulta-sat proxy returned HTTP ${res.status}`);
  }
  return (await res.json()) as ConsultaCfdiResult;
}

let depsPromise: Promise<PipelineDeps> | null = null;

/**
 * Fetches and initializes everything the pipeline needs, exactly once per page load —
 * subsequent calls reuse the same in-flight/resolved promise. Re-registering the XSD
 * buffer provider on every call would leak a duplicate registration (xsdBrowser.ts's
 * own doc comment on why `registerXsdTreeBuffers` is stateful), and re-fetching several
 * MB of static assets per document in a batch would be wasteful — call this once,
 * `auditOne` many times against the same resolved deps.
 */
export function initAuditDeps(): Promise<PipelineDeps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const treeBuffers = {} as XsdTreeBuffers;
      await Promise.all(
        XSD_TREE_FILES.map(async (relPath) => {
          treeBuffers[relPath] = await fetchBytes(`/xsd/${relPath}`);
        }),
      );
      registerXsdTreeBuffers(treeBuffers);
      const xsdValidator = loadCfdiValidatorWithComplementsBrowser(
        [
          {
            namespace: "http://www.sat.gob.mx/TimbreFiscalDigital",
            relativePath: "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd",
          },
        ],
        treeBuffers["cfd/4/cfdv40.xsd"],
      );

      const catalogBundle: CatalogBundle = {};
      await Promise.all(
        CATALOG_TABLES.map(async (table) => {
          const bytes = await fetchBytes(`/catalog-bundle/${table}.json`);
          catalogBundle[table] = JSON.parse(new TextDecoder().decode(bytes));
        }),
      );
      const catalogs = new BrowserCatalogs(catalogBundle);

      const efosIndex = new EfosIndex(await fetchBytes("/efos/listado_completo_69b.csv"));

      return { catalogs, xsdValidator, efosIndex, consultaSat } satisfies PipelineDeps;
    })();
  }
  return depsPromise;
}

/** Audits one CFDI XML document — initializes deps on first call (see `initAuditDeps`),
 *  reuses them on every subsequent call. */
export async function auditOne(xmlBytes: Uint8Array): Promise<CfdiAuditResult> {
  const deps = await initAuditDeps();
  return auditCfdiXml(xmlBytes, deps);
}
