import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { auditZipEntries } from "./audit.ts";
import { BrowserCatalogs, type CatalogBundle } from "../../../engine/src/catalogsBrowser.ts";
import {
  registerXsdTreeBuffers,
  loadCfdiValidatorWithComplementsBrowser,
  XSD_TREE_FILES,
  type XsdTreeBuffers,
} from "../../../engine/src/xsdBrowser.ts";
import type { PipelineDeps } from "../../../engine/src/pipeline.ts";

// Tests auditZipEntries (the pure unzip-and-loop core) with real dependencies built the
// same way engine/test/pipeline.test.ts and engine/test/catalogsBrowser.test.ts already
// proved works — NOT auditZip/initAuditDeps, which need a real fetch() context (a live
// dev server or browser) that a plain Node test script doesn't have. This is the frontend
// equivalent of what those two engine-side test files already establish; not re-deriving
// their conclusions, just proving THIS file's unzip/skip-filtering logic on top of them.

const CORPUS_XSD = path.resolve(import.meta.dirname, "../../../corpus/xsd");
const CATALOG_BUNDLE_DIR = path.resolve(import.meta.dirname, "../../../engine/catalog-bundle");
const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../../../engine/fixtures");

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

function buildDeps(): PipelineDeps {
  const treeBuffers = loadXsdTreeBuffers();
  registerXsdTreeBuffers(treeBuffers);
  const xsdValidator = loadCfdiValidatorWithComplementsBrowser(
    [{ namespace: "http://www.sat.gob.mx/TimbreFiscalDigital", relativePath: "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" }],
    treeBuffers["cfd/4/cfdv40.xsd"],
  );
  return { catalogs: new BrowserCatalogs(loadCatalogBundle()), xsdValidator };
}

test("auditZipEntries: audits every .xml entry, in order, and reports non-xml entries as skipped", async () => {
  const passXml = readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml"));
  const failXml = readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/fail.xml"));
  const zip = zipSync({
    "facturas/buena.xml": new Uint8Array(passXml),
    "facturas/mala.xml": new Uint8Array(failXml),
    "facturas/readme.txt": new TextEncoder().encode("not a CFDI"),
    "facturas/": new Uint8Array(0), // directory entry -- must not appear anywhere
  });

  const report = await auditZipEntries(zip, buildDeps());

  assert.deepEqual(
    report.files.map((f) => f.fileName).sort(),
    ["facturas/buena.xml", "facturas/mala.xml"],
  );
  assert.deepEqual(report.skipped, ["facturas/readme.txt"]);

  const buena = report.files.find((f) => f.fileName === "facturas/buena.xml")!;
  const mala = report.files.find((f) => f.fileName === "facturas/mala.xml")!;
  assert.equal(buena.result.xsdValid, true);
  assert.deepEqual(buena.result.findings.filter((f) => f.ruleId === "regimen-uso-compat"), []);
  assert.equal(mala.result.xsdValid, true);
  assert.equal(mala.result.findings.filter((f) => f.ruleId === "regimen-uso-compat").length, 1);
});

test("auditZipEntries: reports progress via onProgress, one call per xml entry, monotonically", async () => {
  const passXml = new Uint8Array(readFileSync(path.join(FIXTURES_ROOT, "regimen-uso-compat/pass.xml")));
  const zip = zipSync({ "a.xml": passXml, "b.xml": passXml, "c.xml": passXml });

  const calls: Array<[number, number]> = [];
  await auditZipEntries(zip, buildDeps(), (done, total) => calls.push([done, total]));

  assert.deepEqual(calls, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});

test("auditZipEntries: a ZIP with no .xml entries at all produces an empty files array, not an error", async () => {
  const zip = zipSync({ "notes.txt": new TextEncoder().encode("hello") });
  const report = await auditZipEntries(zip, buildDeps());
  assert.deepEqual(report.files, []);
  assert.deepEqual(report.skipped, ["notes.txt"]);
});
