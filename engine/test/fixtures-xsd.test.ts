import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCfdiValidatorWithComplements, validateXml } from "../src/xsd.ts";

// Same corpus layout assumption as xsd-smoke.test.ts — see corpus/README.md.
const CORPUS_XSD = path.resolve(import.meta.dirname, "../../corpus/xsd");
const BASE_SCHEMA = path.join(CORPUS_XSD, "cfd/4/cfdv40.xsd");
const TFD_SCHEMA = path.join(CORPUS_XSD, "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd");

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../fixtures");
// `fail` is optional — see rules.test.ts's manifest type comment for why (a rule can be
// marked failNotConstructible when no real-data fail case exists).
const manifest: { ruleId: string; pass: string; fail?: string; expectFinding: boolean }[] =
  JSON.parse(readFileSync(path.join(FIXTURES_ROOT, "manifest.json"), "utf-8"));

// Every real CFDI carries a TimbreFiscalDigital complement, so this is the validator
// production code needs — see loadCfdiValidatorWithComplements' own doc comment for why
// loadCfdi40Validator alone can never accept a TFD-bearing document.
function getValidator() {
  return loadCfdiValidatorWithComplements(BASE_SCHEMA, [
    { namespace: "http://www.sat.gob.mx/TimbreFiscalDigital", path: TFD_SCHEMA },
  ]);
}

test("every fixture in the manifest is structurally valid CFDI 4.0 + TFD XML", () => {
  const validator = getValidator();
  try {
    for (const entry of manifest) {
      for (const kind of ["pass", "fail"] as const) {
        const rel = entry[kind];
        if (!rel) continue; // deliberately absent fail fixture — see manifest.json
        const absPath = path.resolve(import.meta.dirname, "..", rel);
        const xml = readFileSync(absPath);
        const result = validateXml(validator, xml);
        assert.equal(
          result.valid,
          true,
          `${entry.ruleId}/${kind} (${entry[kind]}) failed XSD validation: ${result.errors.join("; ")}`,
        );
      }
    }
  } finally {
    validator.dispose();
  }
});
