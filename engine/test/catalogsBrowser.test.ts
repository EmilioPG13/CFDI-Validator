import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCfdi } from "../src/parse.ts";
import { SatCatalogs } from "../src/catalogs.ts";
import { BrowserCatalogs, type CatalogBundle } from "../src/catalogsBrowser.ts";
import {
  regimenUsoCompat,
  domicilioFiscalReceptorCpExiste,
  subtotalDescuentoConceptosSuma,
  totalComprobanteConsistencia,
  impuestosTotalesConsistencia,
  monedaTipoCambioConsistencia,
  claveprodservClaveunidadVigente,
  tipodecomprobanteCamposProhibidos,
  impuestosConceptoRollupConsistencia,
  impuestosTrasladosRetencionesUnicidad,
  type Rule,
} from "../src/rules/index.ts";

// Same join points as rules.test.ts (manifest <-> registry <-> rule function) — this file
// isn't re-testing "does the rule match its spec" (rules.test.ts already does that against
// SatCatalogs), it's testing something SatCatalogs alone can't prove: that swapping the
// catalog backend from node:sqlite to the precomputed JSON bundle produces byte-identical
// Finding[] output for every rule, on every fixture, not just "close enough" or "the happy
// path". That's the actual claim Phase 4's whole catalog-bundle strategy rests on.
const CATALOGS_DB_PATH = path.resolve(import.meta.dirname, "../../corpus/catalogs/catalogs.db");
const CATALOG_BUNDLE_DIR = path.resolve(import.meta.dirname, "../catalog-bundle");
const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../fixtures");

const manifest: { ruleId: string; pass: string; fail?: string }[] = JSON.parse(
  readFileSync(path.join(FIXTURES_ROOT, "manifest.json"), "utf-8"),
);

// Only the 10 catalog-backed rules (the `Rule` = `(parsed, catalogs: CatalogSource) =>
// Finding[]` shape) -- cfdi-cancelado-sat, emisor-efos-69b, emisor-efos-69b-sat take a
// completely different second argument (sat-client data, not a catalog), so a catalog
// backend swap is meaningless for them; they're deliberately excluded here, not forgotten.
const catalogRulesByRuleId: Record<string, Rule> = {
  "regimen-uso-compat": regimenUsoCompat,
  "domicilio-fiscal-receptor-cp-existe": domicilioFiscalReceptorCpExiste,
  "subtotal-descuento-conceptos-suma": subtotalDescuentoConceptosSuma,
  "total-comprobante-consistencia": totalComprobanteConsistencia,
  "impuestos-totales-consistencia": impuestosTotalesConsistencia,
  "moneda-tipocambio-consistencia": monedaTipoCambioConsistencia,
  "claveprodserv-claveunidad-vigente": claveprodservClaveunidadVigente,
  "tipodecomprobante-campos-prohibidos": tipodecomprobanteCamposProhibidos,
  "impuestos-concepto-rollup-consistencia": impuestosConceptoRollupConsistencia,
  "impuestos-traslados-retenciones-unicidad": impuestosTrasladosRetencionesUnicidad,
};

function loadFixture(relPath: string) {
  const absPath = path.resolve(import.meta.dirname, "..", relPath);
  return parseCfdi(readFileSync(absPath));
}

function loadBundle(): CatalogBundle {
  const bundle: CatalogBundle = {};
  const manifestPath = path.join(CATALOG_BUNDLE_DIR, "manifest.json");
  const bundleManifest: { tables: Record<string, unknown> } = JSON.parse(readFileSync(manifestPath, "utf-8"));
  for (const table of Object.keys(bundleManifest.tables)) {
    bundle[table] = JSON.parse(readFileSync(path.join(CATALOG_BUNDLE_DIR, `${table}.json`), "utf-8"));
  }
  return bundle;
}

test("catalog-bundle/ exists and covers every table the catalog rules query", () => {
  // A stale or never-generated bundle should fail loudly here, not surface as a mysterious
  // "no Finding" downstream in the parity tests below -- run `node scripts/build-catalog-
  // bundle.mjs` if this fails.
  const bundle = loadBundle();
  const expectedTables = [
    "cfdi_40_monedas",
    "cfdi_40_codigos_postales",
    "cfdi_40_usos_cfdi",
    "cfdi_40_productos_servicios",
    "cfdi_40_claves_unidades",
  ];
  for (const table of expectedTables) {
    assert.ok(Array.isArray(bundle[table]) && bundle[table].length > 0, `catalog-bundle/${table}.json missing or empty`);
  }
});

for (const entry of manifest) {
  const rule = catalogRulesByRuleId[entry.ruleId];
  if (!rule) continue; // sat-client-backed rule, not applicable to this file -- see note above

  const cases: { label: string; relPath: string }[] = [{ label: "pass", relPath: entry.pass }];
  if (entry.fail) cases.push({ label: "fail", relPath: entry.fail });

  for (const { label, relPath } of cases) {
    test(`${entry.ruleId}: BrowserCatalogs matches SatCatalogs exactly on ${label}.xml`, () => {
      const parsed = loadFixture(relPath);
      const sat = new SatCatalogs(CATALOGS_DB_PATH);
      let satFindings;
      try {
        satFindings = rule(parsed, sat);
      } finally {
        sat.close();
      }
      const browser = new BrowserCatalogs(loadBundle());
      const browserFindings = rule(parsed, browser);
      assert.deepEqual(
        browserFindings,
        satFindings,
        `BrowserCatalogs and SatCatalogs disagree for ${entry.ruleId} on ${label}.xml:\n` +
          `SatCatalogs:     ${JSON.stringify(satFindings)}\n` +
          `BrowserCatalogs: ${JSON.stringify(browserFindings)}`,
      );
    });
  }
}
