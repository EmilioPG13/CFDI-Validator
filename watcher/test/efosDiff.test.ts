// EFOS diff tests against synthetic CSVs shaped EXACTLY like the real SAT file layout
// that sat-client's loadEfosIndex expects:
//   row 0: disclaimer line (self-declared as-of date)
//   row 1: any non-empty preamble line
//   row 2: COLUMN-NAME row -- col 1 must be exactly "RFC", col 3 exactly
//          "Situación del contribuyente"
//   row 3+: data rows
// The loader DECODES windows-1252, so fixtures must be ENCODED that way -- TextEncoder
// can't emit windows-1252, hence the manual latin1-range encoder below (throws on
// anything outside it rather than silently mangling an accent).
import { test } from "node:test";
import assert from "node:assert/strict";

import { diffEfosRecords, hasEfosChanges } from "../src/efosWatch.ts";
import { loadEfosIndex } from "../../sat-client/src/efosIndex.ts";

function encodeWindows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`char "${text[i]}" (U+${code.toString(16)}) not representable in windows-1252`);
    out[i] = code;
  }
  return out;
}

const COLUMN_HEADER =
  '"Número y fecha de oficio","RFC","Nombre, denominación o razón social","Situación del contribuyente","Fecha de primera publicación"';

function csvBytes(dataRows: string[][], fecha = "31 de diciembre de 2025"): Uint8Array {
  const disclaimer = `"Este listado es proporcionado por el Servicio de Administración Tributaria, información actualizada al ${fecha}."`;
  const lines = [disclaimer, '"Listado completo del artículo 69-B"', COLUMN_HEADER, ...dataRows];
  return encodeWindows1252(`${lines.join("\r\n")}\r\n`);
}

test("the synthetic fixture itself parses cleanly through sat-client's loader", () => {
  const idx = loadEfosIndex(
    csvBytes([["A/2026", "RFC123456789", "EMPRESA EJEMPLO UNO", "Definitivo", "01 de enero de 2026"]]),
  );
  assert.equal(idx.meta.informacionActualizadaAl, "2025-12-31");
  assert.equal(idx.records.length, 1);
  assert.equal(idx.records[0].situacion, "Definitivo");
});

test("added, removed, and situation-changed RFCs are detected", () => {
  const before = csvBytes([
    ["A/2026", "RFC111111111", "EMPRESA EJEMPLO UNO", "Definitivo", "01 de enero de 2026"],
    ["B/2026", "RFC222222222", "EMPRESA EJEMPLO DOS", "Presunto", "02 de febrero de 2026"],
    ["C/2026", "RFC333333333", "EMPRESA EJEMPLO TRES", "Desvirtuado", "03 de marzo de 2026"],
  ]);
  const after = csvBytes([
    ["A/2026", "RFC111111111", "EMPRESA EJEMPLO UNO", "Definitivo", "01 de enero de 2026"],
    ["B/2026", "RFC222222222", "EMPRESA EJEMPLO DOS", "Definitivo", "02 de febrero de 2026"], // escalated
    ["D/2026", "RFC444444444", "EMPRESA EJEMPLO CUATRO", "Sentencia Favorable", "04 de abril de 2026"], // added
  ]);

  const diff = diffEfosRecords(before, after);
  assert.equal(hasEfosChanges(diff), true);
  assert.deepEqual(diff.added.map((a) => a.rfc), ["RFC444444444"]);
  assert.deepEqual(diff.removed.map((r) => r.rfc), ["RFC333333333"]);
  assert.deepEqual(diff.situationChanges, [
    { rfc: "RFC222222222", nombreContribuyente: "EMPRESA EJEMPLO DOS", before: "Presunto", after: "Definitivo" },
  ]);
  assert.equal(diff.totalBefore, 3);
  assert.equal(diff.totalAfter, 3);
});

test("identical files produce no changes even though bytes are compared elsewhere", () => {
  const bytes = csvBytes([
    ["A/2026", "RFC111111111", "EMPRESA EJEMPLO UNO", "Definitivo", "01 de enero de 2026"],
  ]);
  const diff = diffEfosRecords(bytes, bytes);
  assert.equal(hasEfosChanges(diff), false);
  assert.equal(diff.totalBefore, 1);
  assert.equal(diff.totalAfter, 1);
});

test("declared date change alone counts as a change", () => {
  // Same data rows; different self-declared as-of date in the disclaimer line.
  const rows = [["A/2026", "RFC111111111", "EMPRESA EJEMPLO UNO", "Definitivo", "01 de enero de 2026"]];
  const diff = diffEfosRecords(csvBytes(rows), csvBytes(rows, "09 de marzo de 2026"));
  assert.equal(diff.declaredDateBefore, "2025-12-31");
  assert.equal(diff.declaredDateAfter, "2026-03-09");
  assert.equal(hasEfosChanges(diff), true);
});
