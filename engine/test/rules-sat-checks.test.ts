import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ParsedCfdi } from "../src/parse.ts";
import { cfdiCanceladoSat, emisorEfos69b, emisorEfos69bSat } from "../src/rules/index.ts";
import type { ConsultaCfdiResult } from "../../sat-client/src/consultaCfdi.ts";
import { EfosIndex } from "../../sat-client/src/efosIndex.ts";

const registry: { ruleId: string; fieldPath: string; satReference: string }[] = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../rules/registry.json"), "utf-8"),
).rules;

function minimalParsedCfdi(overrides: Partial<ParsedCfdi> = {}): ParsedCfdi {
  return {
    Version: "4.0",
    Fecha: "2026-08-05T12:00:00",
    Emisor: { Rfc: "XAXX010101000", Nombre: "EMISOR DE PRUEBA", RegimenFiscal: "601" },
    Receptor: {
      Rfc: "XAXX010101000",
      Nombre: "RECEPTOR DE PRUEBA",
      DomicilioFiscalReceptor: "06600",
      RegimenFiscalReceptor: "601",
      UsoCFDI: "G03",
    },
    Complemento: { TimbreFiscalDigital: { UUID: "00000000-0000-0000-0000-000000000000" } },
    SubTotal: "5000.00",
    Total: "5800.00",
    Moneda: "MXN",
    TipoDeComprobante: "I",
    Conceptos: {
      Concepto: [
        { ClaveProdServ: "81111500", ClaveUnidad: "E48", Importe: "5000.00" },
      ],
    },
    Impuestos: {
      TotalImpuestosTrasladados: "800.00",
      Traslados: {
        Traslado: [
          { Base: "5000.00", Impuesto: "002", TipoFactor: "Tasa", TasaOCuota: "0.160000", Importe: "800.00" },
        ],
      },
    },
    ...overrides,
  };
}

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

// --- cfdi-cancelado-sat -----------------------------------------------------------

const cancelacionSpec = registry.find((r) => r.ruleId === "cfdi-cancelado-sat")!;

test("cfdiCanceladoSat: a found, vigente invoice produces no Finding", () => {
  const result = fakeConsultaResult({ found: true, vigente: true, cancelado: false, raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente", esCancelable: "No cancelable", estado: "Vigente", estatusCancelacion: "", validacionEfos: "" } });
  assert.deepEqual(cfdiCanceladoSat(minimalParsedCfdi(), result), []);
});

test("cfdiCanceladoSat: found + cancelado=true produces exactly one Finding matching the spec", () => {
  const result = fakeConsultaResult({ found: true, vigente: false, cancelado: true, raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente", esCancelable: "No cancelable", estado: "Cancelado", estatusCancelacion: "Cancelado sin aceptación", validacionEfos: "" } });
  const findings = cfdiCanceladoSat(minimalParsedCfdi(), result);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.ruleId, "cfdi-cancelado-sat");
  assert.equal(finding.fieldPath, cancelacionSpec.fieldPath);
  assert.equal(finding.severity, "error");
  assert.equal(finding.satReference, cancelacionSpec.satReference);
  assert.ok(finding.evidence);
});

test("cfdiCanceladoSat: found=false (SAT has no record of this UUID) produces no Finding — not treated as 'not cancelled'", () => {
  const result = fakeConsultaResult({ found: false, vigente: null, cancelado: null, raw: { codigoEstatus: "N - 602: Comprobante no encontrado.", esCancelable: "", estado: "No Encontrado", estatusCancelacion: "", validacionEfos: "" } });
  assert.deepEqual(cfdiCanceladoSat(minimalParsedCfdi(), result), []);
});

test("cfdiCanceladoSat: found=true but cancelado=null (unrecognized Estado) produces no Finding — the third, ambiguous state", () => {
  const result = fakeConsultaResult({ found: true, vigente: null, cancelado: null, raw: { codigoEstatus: "S - ok", esCancelable: "", estado: "AlgoInesperado", estatusCancelacion: "", validacionEfos: "" } });
  assert.deepEqual(cfdiCanceladoSat(minimalParsedCfdi(), result), []);
});

// --- emisor-efos-69b --------------------------------------------------------------

const efosSpec = registry.find((r) => r.ruleId === "emisor-efos-69b")!;
const efosIndex = new EfosIndex(
  readFileSync(path.resolve(import.meta.dirname, "../../corpus/efos/listado_completo_69b.csv")),
);

// Real RFCs confirmed present in the actual corpus file, one per situación, found by
// grepping the real CSV directly (not invented) — see the commit that added this test.
const RFC_DEFINITIVO = "AAA120730823"; // "ASESORES Y ADMINISTRADORES AGRICOLAS, S. DE R.L. DE C.V."
const RFC_PRESUNTO = "AAAA730727JE3"; // ALTAMIRANO ABENDAÑO ALEJANDRO JORGE
const RFC_DESVIRTUADO = "AAA091014835"; // "AQUAERIS ACUACULTURA Y ARQUITECTURA SUSTENTABLE, S.C."
const RFC_SENTENCIA_FAVORABLE = "AAA080808HL8"; // "ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V."
const RFC_NOT_ON_LIST = "XAXX010101000";

test("emisorEfos69b: Definitivo produces exactly one error Finding matching the spec", () => {
  const parsed = minimalParsedCfdi({ Emisor: { Rfc: RFC_DEFINITIVO, Nombre: "x", RegimenFiscal: "601" } });
  const findings = emisorEfos69b(parsed, efosIndex);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.ruleId, "emisor-efos-69b");
  assert.equal(finding.fieldPath, efosSpec.fieldPath);
  assert.equal(finding.severity, "error");
  assert.equal(finding.satReference, efosSpec.satReference);
  assert.equal((finding.evidence as { situacion: string }).situacion, "Definitivo");
  assert.ok((finding.evidence as { informacionActualizadaAl: string }).informacionActualizadaAl);
});

test("emisorEfos69b: Presunto produces exactly one warning Finding", () => {
  const parsed = minimalParsedCfdi({ Emisor: { Rfc: RFC_PRESUNTO, Nombre: "x", RegimenFiscal: "601" } });
  const findings = emisorEfos69b(parsed, efosIndex);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.equal((findings[0].evidence as { situacion: string }).situacion, "Presunto");
});

test("emisorEfos69b: Desvirtuado produces no Finding at all (SAT itself concluded no simulation was proven)", () => {
  const parsed = minimalParsedCfdi({ Emisor: { Rfc: RFC_DESVIRTUADO, Nombre: "x", RegimenFiscal: "601" } });
  assert.deepEqual(emisorEfos69b(parsed, efosIndex), []);
});

test("emisorEfos69b: Sentencia Favorable produces no Finding at all (a court reversed the presumption)", () => {
  const parsed = minimalParsedCfdi({ Emisor: { Rfc: RFC_SENTENCIA_FAVORABLE, Nombre: "x", RegimenFiscal: "601" } });
  assert.deepEqual(emisorEfos69b(parsed, efosIndex), []);
});

test("emisorEfos69b: an RFC genuinely absent from the list produces no Finding", () => {
  const parsed = minimalParsedCfdi({ Emisor: { Rfc: RFC_NOT_ON_LIST, Nombre: "x", RegimenFiscal: "601" } });
  assert.deepEqual(emisorEfos69b(parsed, efosIndex), []);
});

// --- emisor-efos-69b-sat -----------------------------------------------------------

const efosSatSpec = registry.find((r) => r.ruleId === "emisor-efos-69b-sat")!;

test("emisorEfos69bSat: efosEmisorEncontrado=true produces exactly one error Finding matching the spec", () => {
  const result = fakeConsultaResult({
    found: true,
    efosEmisorEncontrado: true,
    raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente", esCancelable: "Cancelable sin aceptación", estado: "Vigente", estatusCancelacion: "", validacionEfos: "100" },
  });
  const findings = emisorEfos69bSat(minimalParsedCfdi(), result);
  assert.equal(findings.length, 1);
  const [finding] = findings;
  assert.equal(finding.ruleId, "emisor-efos-69b-sat");
  assert.equal(finding.fieldPath, efosSatSpec.fieldPath);
  assert.equal(finding.severity, "error");
  assert.equal(finding.satReference, efosSatSpec.satReference);
  assert.ok(finding.evidence);
});

test("emisorEfos69bSat: efosEmisorEncontrado=false produces no Finding", () => {
  const result = fakeConsultaResult({
    found: true,
    efosEmisorEncontrado: false,
    raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente", esCancelable: "No cancelable", estado: "Vigente", estatusCancelacion: "", validacionEfos: "200" },
  });
  assert.deepEqual(emisorEfos69bSat(minimalParsedCfdi(), result), []);
});

test("emisorEfos69bSat: efosEmisorEncontrado=null produces no Finding — the third, undetermined state, not treated as false", () => {
  const result = fakeConsultaResult({
    found: true,
    efosEmisorEncontrado: null,
    raw: { codigoEstatus: "S - ok", esCancelable: "", estado: "Vigente", estatusCancelacion: "", validacionEfos: "" },
  });
  assert.deepEqual(emisorEfos69bSat(minimalParsedCfdi(), result), []);
});

test("emisorEfos69bSat: found=false (SAT has no record of this UUID) produces no Finding — not treated as 'Emisor not on the list'", () => {
  const result = fakeConsultaResult({
    found: false,
    efosEmisorEncontrado: null,
    raw: { codigoEstatus: "N - 602: Comprobante no encontrado.", esCancelable: "", estado: "No Encontrado", estatusCancelacion: "", validacionEfos: "" },
  });
  assert.deepEqual(emisorEfos69bSat(minimalParsedCfdi(), result), []);
});

test("emisorEfos69bSat and cfdiCanceladoSat are independent: a result with both cancelado=true and efosEmisorEncontrado=true produces exactly one Finding from each rule, never short-circuiting the other (spec condition step 5)", () => {
  const result = fakeConsultaResult({
    found: true,
    vigente: false,
    cancelado: true,
    efosEmisorEncontrado: true,
    raw: { codigoEstatus: "S - Comprobante obtenido satisfactoriamente", esCancelable: "No cancelable", estado: "Cancelado", estatusCancelacion: "Cancelado sin aceptación", validacionEfos: "100" },
  });
  const parsed = minimalParsedCfdi();

  const cancelacionFindings = cfdiCanceladoSat(parsed, result);
  const efosSatFindings = emisorEfos69bSat(parsed, result);

  assert.equal(cancelacionFindings.length, 1);
  assert.equal(cancelacionFindings[0].ruleId, "cfdi-cancelado-sat");
  assert.equal(efosSatFindings.length, 1);
  assert.equal(efosSatFindings[0].ruleId, "emisor-efos-69b-sat");
});
