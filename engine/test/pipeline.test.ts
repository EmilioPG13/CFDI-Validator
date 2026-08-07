import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { auditCfdiXml, type PipelineDeps } from "../src/pipeline.ts";
import { BrowserCatalogs, type CatalogBundle } from "../src/catalogsBrowser.ts";
import {
  registerXsdTreeBuffers,
  loadCfdiValidatorWithComplementsBrowser,
  XSD_TREE_FILES,
  type XsdTreeBuffers,
} from "../src/xsdBrowser.ts";
import { EfosIndex } from "../../sat-client/src/efosIndex.ts";
import type { ConsultaCfdiResult } from "../../sat-client/src/consultaCfdi.ts";

// This is the integration test for Phase 4's whole thesis: build every dependency the
// SAME way a real browser deployment will (BrowserCatalogs from the JSON bundle,
// XsdValidator from an in-memory buffer provider, not node:sqlite/real disk for either),
// then run the actual public auditCfdiXml() function end-to-end against real fixtures —
// not the individual pieces in isolation, which catalogsBrowser.test.ts and
// xsdBrowser.test.ts already cover.

const CORPUS_XSD = path.resolve(import.meta.dirname, "../../corpus/xsd");
const CATALOG_BUNDLE_DIR = path.resolve(import.meta.dirname, "../catalog-bundle");
const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../fixtures");
const CORPUS_EFOS_CSV = path.resolve(import.meta.dirname, "../../corpus/efos/listado_completo_69b.csv");

function loadXsdTreeBuffers(): XsdTreeBuffers {
  const buffers = {} as XsdTreeBuffers;
  for (const relPath of XSD_TREE_FILES) {
    buffers[relPath] = new Uint8Array(readFileSync(path.join(CORPUS_XSD, relPath)));
  }
  return buffers;
}

function loadCatalogBundle(): CatalogBundle {
  const bundle: CatalogBundle = {};
  const bundleManifest: { tables: Record<string, unknown> } = JSON.parse(
    readFileSync(path.join(CATALOG_BUNDLE_DIR, "manifest.json"), "utf-8"),
  );
  for (const table of Object.keys(bundleManifest.tables)) {
    bundle[table] = JSON.parse(readFileSync(path.join(CATALOG_BUNDLE_DIR, `${table}.json`), "utf-8"));
  }
  return bundle;
}

const treeBuffers = loadXsdTreeBuffers();
registerXsdTreeBuffers(treeBuffers);

function baseDeps(): PipelineDeps {
  const validator = loadCfdiValidatorWithComplementsBrowser(
    [{ namespace: "http://www.sat.gob.mx/TimbreFiscalDigital", relativePath: "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" }],
    treeBuffers["cfd/4/cfdv40.xsd"],
  );
  return { catalogs: new BrowserCatalogs(loadCatalogBundle()), xsdValidator: validator };
}

// --- Full manifest, every catalog rule, through the real public pipeline function -------

const manifest: { ruleId: string; pass: string; fail?: string; expectedFailFindingCount?: number }[] =
  JSON.parse(readFileSync(path.join(FIXTURES_ROOT, "manifest.json"), "utf-8"));

for (const entry of manifest) {
  test(`pipeline: ${entry.ruleId} pass.xml produces no Finding for this ruleId end-to-end`, async () => {
    const xml = new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "..", entry.pass)));
    const result = await auditCfdiXml(xml, baseDeps());
    assert.equal(result.xsdValid, true, `unexpected XSD errors: ${result.xsdErrors.join("; ")}`);
    const own = result.findings.filter((f) => f.ruleId === entry.ruleId);
    assert.deepEqual(own, []);
  });

  if (entry.fail) {
    const failPath = entry.fail;
    test(`pipeline: ${entry.ruleId} fail.xml produces the expected Finding(s) end-to-end`, async () => {
      const xml = new Uint8Array(readFileSync(path.resolve(import.meta.dirname, "..", failPath)));
      const result = await auditCfdiXml(xml, baseDeps());
      assert.equal(result.xsdValid, true, `unexpected XSD errors: ${result.xsdErrors.join("; ")}`);
      const own = result.findings.filter((f) => f.ruleId === entry.ruleId);
      assert.equal(own.length, entry.expectedFailFindingCount ?? 1);
    });
  }
}

// --- XSD-invalid input never reaches rule evaluation -------------------------------------

test("pipeline: structurally invalid XML short-circuits at XSD validation, never runs rules", async () => {
  const result = await auditCfdiXml(new TextEncoder().encode("<NotACfdi/>"), baseDeps());
  assert.equal(result.xsdValid, false);
  assert.ok(result.xsdErrors.length > 0);
  assert.deepEqual(result.findings, []);
});

// --- efosIndex wiring (optional dep) ------------------------------------------------------

test("pipeline: efosIndex wired in produces an emisor-efos-69b Finding for a Definitivo RFC", async () => {
  const xml = readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml"), "utf-8");
  // RFC_DEFINITIVO from rules-sat-checks.test.ts -- a real RFC confirmed present in the
  // actual corpus CSV under situación "Definitivo", not invented.
  const swapped = xml.replace('Emisor Rfc="ABC010101AB1"', 'Emisor Rfc="AAA120730823"');
  const efosIndex = new EfosIndex(readFileSync(CORPUS_EFOS_CSV));
  const deps = { ...baseDeps(), efosIndex };
  const result = await auditCfdiXml(new TextEncoder().encode(swapped), deps);
  assert.equal(result.xsdValid, true, `unexpected XSD errors: ${result.xsdErrors.join("; ")}`);
  const efosFindings = result.findings.filter((f) => f.ruleId === "emisor-efos-69b");
  assert.equal(efosFindings.length, 1);
  assert.equal(efosFindings[0].severity, "error");
});

test("pipeline: omitting efosIndex skips emisor-efos-69b entirely, even for a Definitivo RFC", async () => {
  const xml = readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml"), "utf-8");
  const swapped = xml.replace('Emisor Rfc="ABC010101AB1"', 'Emisor Rfc="AAA120730823"');
  const result = await auditCfdiXml(new TextEncoder().encode(swapped), baseDeps());
  assert.deepEqual(result.findings.filter((f) => f.ruleId === "emisor-efos-69b"), []);
});

// --- consultaSat wiring (optional dep) -----------------------------------------------------

function fakeConsultaResult(overrides: Partial<ConsultaCfdiResult>): ConsultaCfdiResult {
  return {
    raw: { codigoEstatus: "", esCancelable: "", estado: "", estatusCancelacion: "", validacionEfos: "" },
    found: true,
    vigente: null,
    cancelado: null,
    efosEmisorEncontrado: null,
    ...overrides,
  };
}

test("pipeline: consultaSat wired in produces BOTH cfdi-cancelado-sat and emisor-efos-69b-sat Findings, neither short-circuiting the other", async () => {
  const xml = new Uint8Array(readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml")));
  const deps: PipelineDeps = {
    ...baseDeps(),
    consultaSat: async () => fakeConsultaResult({ cancelado: true, vigente: false, efosEmisorEncontrado: true }),
  };
  const result = await auditCfdiXml(xml, deps);
  assert.equal(result.satUnverified, undefined);
  assert.equal(result.findings.filter((f) => f.ruleId === "cfdi-cancelado-sat").length, 1);
  assert.equal(result.findings.filter((f) => f.ruleId === "emisor-efos-69b-sat").length, 1);
});

test("pipeline: consultaSat throwing marks satUnverified and adds no SAT-live Findings, without losing local findings", async () => {
  // fail.xml for this rule still exists, so the pipeline should still surface its own
  // catalog-rule Finding even though the SAT call failed -- one dependency failing must
  // not take down the rest of the report.
  const xml = new Uint8Array(readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/fail.xml")));
  const deps: PipelineDeps = {
    ...baseDeps(),
    consultaSat: async () => {
      throw new Error("network timeout");
    },
  };
  const result = await auditCfdiXml(xml, deps);
  assert.equal(result.satUnverified, true);
  assert.deepEqual(result.findings.filter((f) => f.ruleId === "cfdi-cancelado-sat"), []);
  assert.deepEqual(result.findings.filter((f) => f.ruleId === "emisor-efos-69b-sat"), []);
  assert.equal(result.findings.filter((f) => f.ruleId === "regimen-uso-compat").length, 1);
});

test("pipeline: a document with no TimbreFiscalDigital/UUID marks satUnverified without calling consultaSat at all", async () => {
  const xml = readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml"), "utf-8");
  const withoutComplemento = xml.replace(/<cfdi:Complemento>[\s\S]*?<\/cfdi:Complemento>/, "");
  let called = false;
  const deps: PipelineDeps = {
    ...baseDeps(),
    consultaSat: async () => {
      called = true;
      return fakeConsultaResult({});
    },
  };
  const result = await auditCfdiXml(new TextEncoder().encode(withoutComplemento), deps);
  assert.equal(result.xsdValid, true, `unexpected XSD errors: ${result.xsdErrors.join("; ")}`);
  assert.equal(result.satUnverified, true);
  assert.equal(called, false, "consultaSat must not be called when there's no UUID to query with");
});
