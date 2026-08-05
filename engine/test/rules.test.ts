import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCfdi } from "../src/parse.ts";
import { SatCatalogs } from "../src/catalogs.ts";
import {
  regimenUsoCompat,
  domicilioFiscalReceptorCpExiste,
  subtotalDescuentoConceptosSuma,
  totalComprobanteConsistencia,
  impuestosTotalesConsistencia,
  monedaTipoCambioConsistencia,
  claveprodservClaveunidadVigente,
  type Rule,
} from "../src/rules/index.ts";

// Same corpus layout assumption as the other tests — see corpus/README.md. Must be a real,
// absolute, Windows-style path (see engine/CLAUDE.md gotchas on why node:sqlite fails
// silently-ish on a POSIX /c/... path here).
const CATALOGS_DB_PATH = path.resolve(import.meta.dirname, "../../corpus/catalogs/catalogs.db");

const FIXTURES_ROOT = path.resolve(import.meta.dirname, "../fixtures");
// `fail` is optional: a rule whose condition genuinely cannot be violated with real
// catalog/corpus data (see claveprodserv-claveunidad-vigente's failNotConstructibleReason
// in manifest.json) has a pass.xml only. Don't assume every entry has a fail case.
const manifest: {
  ruleId: string;
  pass: string;
  fail?: string;
  expectFinding: boolean;
  failNotConstructible?: boolean;
}[] = JSON.parse(readFileSync(path.join(FIXTURES_ROOT, "manifest.json"), "utf-8"));

const registry: { ruleId: string; fieldPath: string; severity: string; satReference: string }[] =
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../rules/registry.json"), "utf-8"))
    .rules;

// Each rule's own function, keyed by the ruleId it implements — the manifest and registry
// are both keyed the same way, so this is the join point between fixture, spec, and code.
const rulesByRuleId: Record<string, Rule> = {
  "regimen-uso-compat": regimenUsoCompat,
  "domicilio-fiscal-receptor-cp-existe": domicilioFiscalReceptorCpExiste,
  "subtotal-descuento-conceptos-suma": subtotalDescuentoConceptosSuma,
  "total-comprobante-consistencia": totalComprobanteConsistencia,
  "impuestos-totales-consistencia": impuestosTotalesConsistencia,
  "moneda-tipocambio-consistencia": monedaTipoCambioConsistencia,
  "claveprodserv-claveunidad-vigente": claveprodservClaveunidadVigente,
};

function loadFixture(relPath: string) {
  const absPath = path.resolve(import.meta.dirname, "..", relPath);
  return parseCfdi(readFileSync(absPath));
}

test("every ruleId in the manifest has an implementation wired into rulesByRuleId", () => {
  for (const entry of manifest) {
    assert.ok(
      rulesByRuleId[entry.ruleId],
      `no rule function registered for ruleId ${entry.ruleId}`,
    );
  }
});

for (const entry of manifest) {
  const rule = rulesByRuleId[entry.ruleId];
  const spec = registry.find((r) => r.ruleId === entry.ruleId);

  test(`${entry.ruleId}: pass.xml produces no Finding for this ruleId`, () => {
    assert.ok(rule, `no rule function registered for ${entry.ruleId}`);
    assert.ok(spec, `no registry spec found for ${entry.ruleId}`);
    const catalogs = new SatCatalogs(CATALOGS_DB_PATH);
    try {
      const parsed = loadFixture(entry.pass);
      const findings = rule(parsed, catalogs).filter((f) => f.ruleId === entry.ruleId);
      assert.deepEqual(findings, [], `expected no findings, got ${JSON.stringify(findings)}`);
    } finally {
      catalogs.close();
    }
  });

  // Entries without a `fail` fixture (failNotConstructible: true in manifest.json) have
  // nothing to assert here by design -- see the entry's failNotConstructibleReason for why
  // no fail case exists, rather than skip silently with no trace of the decision.
  if (entry.fail) {
    const failPath = entry.fail;
    test(`${entry.ruleId}: fail.xml produces exactly one Finding for this ruleId, matching the spec`, () => {
      assert.ok(rule, `no rule function registered for ${entry.ruleId}`);
      assert.ok(spec, `no registry spec found for ${entry.ruleId}`);
      const catalogs = new SatCatalogs(CATALOGS_DB_PATH);
      try {
        const parsed = loadFixture(failPath);
        const findings = rule(parsed, catalogs).filter((f) => f.ruleId === entry.ruleId);
        assert.equal(
          findings.length,
          1,
          `expected exactly one finding, got ${JSON.stringify(findings)}`,
        );
        const [finding] = findings;
        assert.equal(finding.ruleId, entry.ruleId);
        assert.equal(finding.fieldPath, spec!.fieldPath);
        assert.equal(finding.severity, spec!.severity);
        assert.equal(finding.satReference, spec!.satReference);
        assert.ok(finding.evidence !== undefined && finding.evidence !== null);
      } finally {
        catalogs.close();
      }
    });
  } else {
    test(`${entry.ruleId}: missing fail fixture is a documented, deliberate omission`, () => {
      assert.ok(
        entry.failNotConstructible,
        `${entry.ruleId} has no fail fixture but isn't marked failNotConstructible -- looks like a missing fixture, not a deliberate omission`,
      );
    });
  }
}
