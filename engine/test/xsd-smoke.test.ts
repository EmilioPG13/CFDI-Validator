import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { loadCfdi40Validator, validateXml } from "../src/xsd.ts";

// Phase 0 corpus lives one level up from engine/, mirroring the real schemaLocation
// tree exactly (see ../../corpus/README.md) — do not point this at a flattened copy.
const SCHEMA_PATH = path.resolve(
  import.meta.dirname,
  "../../corpus/xsd/cfd/4/cfdv40.xsd",
);

test("cfdv40.xsd compiles — every xsd:import in the tree resolves from disk", () => {
  // If catCFDI.xsd or tdCFDI.xsd failed to resolve via the relative schemaLocation
  // paths, this throws during compilation, before any document is even validated.
  const validator = loadCfdi40Validator(SCHEMA_PATH);
  assert.ok(validator, "validator compiled without throwing");
  validator.dispose();
});

test("a structurally-wrong document fails validation with a content error, not a resolution error", () => {
  const validator = loadCfdi40Validator(SCHEMA_PATH);
  try {
    // Deliberately not a Comprobante at all — proves the validator actually inspects
    // content (not silently passing everything), while staying agnostic to the many
    // required CFDI attributes real fixture-gen fixtures will need later.
    const result = validateXml(validator, "<NotACfdi/>");
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
    const message = result.errors.join("\n").toLowerCase();
    // A resolution failure would mention a missing file/schema; a content failure
    // talks about the element itself. Guard against silently swallowing the former.
    assert.doesNotMatch(message, /no such file|failed to load|enoent/);
  } finally {
    validator.dispose();
  }
});
