import { test } from "node:test";
import assert from "node:assert/strict";
import { redactFindingForExplainer, redactFindingsForExplainer } from "./redact.ts";
import type { Finding } from "../../../engine/src/finding.ts";

test("redacts rfcEmisor, rfcReceptor, uuid, nombreContribuyente, and raw -- the identifying keys actually used across the real rule evidence shapes", () => {
  const finding: Finding = {
    ruleId: "cfdi-cancelado-sat",
    fieldPath: "Comprobante/Complemento/TimbreFiscalDigital/@UUID",
    severity: "error",
    satReference: "CFF Art. 29-A",
    evidence: {
      uuid: "11111111-2222-3333-4444-555555555555",
      rfcEmisor: "AAA010101AAA",
      rfcReceptor: "BBB020202BBB",
      raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente.", estado: "Cancelado" },
      consultadoEl: "2026-08-09T00:00:00.000Z",
    },
  };

  const redacted = redactFindingForExplainer(finding);

  assert.equal((redacted.evidence as Record<string, unknown>).uuid, "[redactado]");
  assert.equal((redacted.evidence as Record<string, unknown>).rfcEmisor, "[redactado]");
  assert.equal((redacted.evidence as Record<string, unknown>).rfcReceptor, "[redactado]");
  assert.equal((redacted.evidence as Record<string, unknown>).raw, "[redactado]");
  // Non-identifying fields survive -- the Explainer still needs them.
  assert.equal((redacted.evidence as Record<string, unknown>).consultadoEl, "2026-08-09T00:00:00.000Z");
});

test("does not mutate the original Finding", () => {
  const finding: Finding = {
    ruleId: "emisor-efos-69b",
    fieldPath: "Comprobante/Emisor/@Rfc",
    severity: "error",
    satReference: "LFPIORPI Art. 69-B",
    evidence: { rfcEmisor: "AAA010101AAA", nombreContribuyente: "EMPRESA DE PRUEBA SA DE CV", situacion: "Definitivo" },
  };
  const redacted = redactFindingForExplainer(finding);
  assert.equal((finding.evidence as Record<string, unknown>).rfcEmisor, "AAA010101AAA", "original must be untouched");
  assert.notEqual(redacted, finding, "must return a new object, not mutate in place");
});

test("leaves ruleId/fieldPath/severity/satReference untouched -- only evidence is redacted", () => {
  const finding: Finding = {
    ruleId: "regimen-uso-compat",
    fieldPath: "Comprobante/Receptor/@RegimenFiscalReceptor",
    severity: "error",
    satReference: "phpcfdi/resources-sat-catalogs, tabla cfdi_40_usos_cfdi",
    evidence: { RegimenFiscalReceptor: "601", UsoCFDI: "G01" },
  };
  const redacted = redactFindingForExplainer(finding);
  assert.equal(redacted.ruleId, finding.ruleId);
  assert.equal(redacted.fieldPath, finding.fieldPath);
  assert.equal(redacted.severity, finding.severity);
  assert.equal(redacted.satReference, finding.satReference);
});

test("handles a Finding whose evidence has no identifying keys at all -- nothing spuriously redacted", () => {
  const finding: Finding = {
    ruleId: "claveprodserv-claveunidad-vigente",
    fieldPath: "Comprobante/Conceptos/Concepto[0]/@ClaveProdServ",
    severity: "warning",
    satReference: "catalogs.db, tabla cfdi_40_productos_servicios",
    evidence: { claveProdServ: "01010101", conceptoIndex: 0 },
  };
  const redacted = redactFindingForExplainer(finding);
  assert.deepEqual(redacted.evidence, finding.evidence);
});

test("redactFindingsForExplainer: redacts a whole batch", () => {
  const findings: Finding[] = [
    { ruleId: "a", fieldPath: "x", severity: "error", satReference: "s", evidence: { rfcEmisor: "AAA010101AAA" } },
    { ruleId: "b", fieldPath: "y", severity: "warning", satReference: "s2", evidence: { uuid: "u" } },
  ];
  const redacted = redactFindingsForExplainer(findings);
  assert.equal(redacted.length, 2);
  assert.equal((redacted[0].evidence as Record<string, unknown>).rfcEmisor, "[redactado]");
  assert.equal((redacted[1].evidence as Record<string, unknown>).uuid, "[redactado]");
});
