// Grounding layer tests: the deterministic guard that keeps the narrator honest. These
// mirror the philosophy of backend/test/verifier.test.ts -- every rejection reason is
// exercised with a real-shaped input, not a toy.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildFactsJson, buildGroundingSet, verifyNarrationGrounding } from "../src/narrate.ts";
import type { NarrationFacts } from "../src/narrate.ts";

const FACTS: NarrationFacts = {
  fuentes_cambiadas: ["Catálogos", "Listado 69-B"],
  catalogs: {
    release_anterior: "v9.51.20260302",
    release_nueva: "v9.52.20260313",
    tablas: [
      {
        tabla: "cfdi_40_monedas",
        altas: 2,
        bajas: 1,
        modificados: 0,
        ejemplos_altas: [{ id: "XXX", decimales: "0" }],
      },
    ],
  },
  efos: {
    fecha_declarada_anterior: "2025-12-31",
    fecha_declarada_nueva: "2026-03-09",
    agregados_total: 42,
  },
};

test("numbers, codes, and source names present in the facts pass grounding", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen =
    "- Catálogos: v9.51.20260302 -> v9.52.20260313; cfdi_40_monedas con 2 altas, 1 baja.\n" +
    "- Listado 69-B: fecha declarada 2025-12-31 -> 2026-03-09, con 42 agregados.";
  assert.equal(verifyNarrationGrounding(resumen, grounded).passed, true);
});

test("an invented number is rejected", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen = "- cfdi_40_monedas con 847 altas."; // 847 appears nowhere in FACTS
  const verdict = verifyNarrationGrounding(resumen, grounded);
  assert.equal(verdict.passed, false);
  assert.ok(verdict.violations.some((v) => v.includes("847")));
});

test("an invented catalog code is rejected", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen = "- Se incorporó la moneda ZZZ al catálogo.";
  const verdict = verifyNarrationGrounding(resumen, grounded);
  assert.equal(verdict.passed, false);
  assert.ok(verdict.violations.some((v) => v.includes("ZZZ")), JSON.stringify(verdict.violations));
});

test("the real catalog code from the data passes", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen = "- Alta de la moneda XXX (0 decimales).";
  const verdict = verifyNarrationGrounding(resumen, grounded);
  assert.equal(verdict.passed, true, JSON.stringify(verdict.violations));
});

test("citation-shaped tokens are rejected outright, even plausible ones", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen =
    "- El cambio obedece al artículo 29-A del CFF y a la regla 2.7.1.35 de la RMF.";
  const verdict = verifyNarrationGrounding(resumen, grounded);
  assert.equal(verdict.passed, false);
  // BOTH citation shapes flagged: the article and the dotted RMF rule number.
  assert.ok(verdict.violations.length >= 2, JSON.stringify(verdict.violations));
});

test("trailing punctuation on a real number does not break grounding", () => {
  const grounded = buildGroundingSet(buildFactsJson(FACTS));
  const resumen = "- Hubo 42 agregados, según DATOS. La fecha nueva es 2026-03-09.";
  assert.equal(verifyNarrationGrounding(resumen, grounded).passed, true);
});
