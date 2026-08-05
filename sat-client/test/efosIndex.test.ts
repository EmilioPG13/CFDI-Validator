import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EfosIndex } from "../src/efosIndex.ts";

// The real, unmodified corpus file — see corpus/README.md for provenance and the
// flagged staleness gap (self-reports current to 2025-12-31).
const CSV_PATH = path.resolve(import.meta.dirname, "../../corpus/efos/listado_completo_69b.csv");
const csvBuffer = readFileSync(CSV_PATH);

test("EfosIndex: parses the real 69-B file and reads its self-reported 'as of' date", () => {
  const index = new EfosIndex(csvBuffer);
  assert.equal(index.meta.informacionActualizadaAl, "2025-12-31");
  // "No" column's last real row was 14234 in the raw file at inspection time; allow
  // for a handful of duplicate RFCs collapsing in the byRfc map without asserting an
  // exact brittle count here — the record *array* (pre-dedup) is what should match.
  assert.ok(index.meta.totalRecords > 14000, `expected >14000 records, got ${index.meta.totalRecords}`);
});

test("EfosIndex: looks up a known RFC from the real file with the correct situación", () => {
  const index = new EfosIndex(csvBuffer);
  // Confirmed present in the real corpus file by direct inspection (see the commit
  // that added this test) — "ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.", the exact
  // row this project's CSV parser was written to handle correctly (embedded comma in
  // a quoted razón social).
  const record = index.lookup("AAA080808HL8");
  assert.ok(record, "expected to find RFC AAA080808HL8 in the real 69-B list");
  assert.equal(record?.situacion, "Sentencia Favorable");
  assert.match(record?.nombreContribuyente ?? "", /ASESORES EN AVALÚOS Y ACTIVOS/);
});

test("EfosIndex: lookup is case-insensitive and trims whitespace", () => {
  const index = new EfosIndex(csvBuffer);
  assert.ok(index.lookup("aaa080808hl8"));
  assert.ok(index.lookup("  AAA080808HL8  "));
});

test("EfosIndex: an RFC that's genuinely not on the list returns undefined, not a false positive", () => {
  const index = new EfosIndex(csvBuffer);
  assert.equal(index.lookup("XAXX010101000"), undefined);
});
