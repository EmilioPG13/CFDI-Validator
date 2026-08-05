import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.ts";

test("parseCsv: plain fields, no quoting", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3\n"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCsv: quoted field with an embedded comma — the exact shape that breaks a naive split(',')", () => {
  assert.deepEqual(parseCsv('1,AAA080808HL8,"ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.",Sentencia Favorable\n'), [
    ["1", "AAA080808HL8", "ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.", "Sentencia Favorable"],
  ]);
});

test("parseCsv: escaped double-quote inside a quoted field", () => {
  assert.deepEqual(parseCsv('1,"say ""hi"" please"\n'), [["1", 'say "hi" please']]);
});

test("parseCsv: CRLF line endings normalize the same as LF", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsv: trailing row with no final newline is still captured", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});
