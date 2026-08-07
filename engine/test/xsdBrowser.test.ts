import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  registerXsdTreeBuffers,
  loadCfdi40ValidatorBrowser,
  loadCfdiValidatorWithComplementsBrowser,
  validateXmlBrowser,
  XSD_TREE_FILES,
  type XsdTreeBuffers,
} from "../src/xsdBrowser.ts";

// This file proves the SAME claim fixtures-xsd.test.ts / xsd-smoke.test.ts prove for the
// Node path (xsd.ts), but for the browser path (xsdBrowser.ts): every real fixture
// validates correctly when the XSD tree is served from an in-memory XmlBufferInputProvider
// instead of real disk. The bytes here are read from disk via node:fs, same as any other
// test in this suite -- that's this TEST's I/O, not xsdBrowser.ts's; the module under test
// never touches node:fs itself (see that file's own header comment on why).
const CORPUS_XSD = path.resolve(import.meta.dirname, "../../corpus/xsd");

function loadXsdTreeBuffers(): XsdTreeBuffers {
  const buffers = {} as XsdTreeBuffers;
  for (const relPath of XSD_TREE_FILES) {
    buffers[relPath] = new Uint8Array(readFileSync(path.join(CORPUS_XSD, relPath)));
  }
  return buffers;
}

// Registered once at module scope, mirroring how a real app registers the buffer
// provider once at startup (after fetching the tree) rather than per-validator-load —
// see registerXsdTreeBuffers' own doc comment on why this is a one-time, stateful step.
const treeBuffers = loadXsdTreeBuffers();
registerXsdTreeBuffers(treeBuffers);

test("cfdv40.xsd compiles via XmlBufferInputProvider — every xsd:import resolves from memory, not disk", () => {
  const validator = loadCfdi40ValidatorBrowser(treeBuffers["cfd/4/cfdv40.xsd"]);
  assert.ok(validator, "validator compiled without throwing");
  validator.dispose();
});

test("a structurally-wrong document fails validation with a content error, not a resolution error (browser path)", () => {
  const validator = loadCfdi40ValidatorBrowser(treeBuffers["cfd/4/cfdv40.xsd"]);
  try {
    const result = validateXmlBrowser(validator, "<NotACfdi/>");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    const message = result.errors.join("\n").toLowerCase();
    assert.doesNotMatch(message, /no such file|failed to load|enoent/);
  } finally {
    validator.dispose();
  }
});

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../fixtures");
const manifest: { ruleId: string; pass: string; fail?: string }[] = JSON.parse(
  readFileSync(path.join(FIXTURES_ROOT, "manifest.json"), "utf-8"),
);

function getComplementValidator() {
  return loadCfdiValidatorWithComplementsBrowser(
    [{ namespace: "http://www.sat.gob.mx/TimbreFiscalDigital", relativePath: "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd" }],
    treeBuffers["cfd/4/cfdv40.xsd"],
  );
}

test("every fixture in the manifest is structurally valid CFDI 4.0 + TFD XML — browser path matches the Node path exactly", () => {
  const validator = getComplementValidator();
  try {
    for (const entry of manifest) {
      for (const kind of ["pass", "fail"] as const) {
        const rel = entry[kind];
        if (!rel) continue;
        const absPath = path.resolve(import.meta.dirname, "..", rel);
        const xml = new Uint8Array(readFileSync(absPath));
        const result = validateXmlBrowser(validator, xml);
        assert.equal(
          result.valid,
          true,
          `${entry.ruleId}/${kind} (${entry[kind]}) failed XSD validation via the browser path: ${result.errors.join("; ")}`,
        );
      }
    }
  } finally {
    validator.dispose();
  }
});
