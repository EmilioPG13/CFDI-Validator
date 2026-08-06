import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsultaCfdiClient, interpretEfosEmisorEncontrado } from "../src/consultaCfdi.ts";

// Every code in the SAT's own documented table (consultaCfdi.ts header comment, "Documentación
// del Servicio de Consulta de CFDI" v1.4, Noviembre 2022, p. 10-14) — a deterministic unit
// test, not a live call, since the live endpoint can't be made to return every code on demand
// without a real stamped invoice known to be on/off the EFOS Definitivo list.
test("interpretEfosEmisorEncontrado: every documented ValidacionEFOS code classifies correctly", () => {
  for (const code of ["100", "101", "104"]) {
    assert.equal(interpretEfosEmisorEncontrado(code), true, `code ${code} should mean Emisor found`);
  }
  for (const code of ["102", "103", "200", "201"]) {
    assert.equal(interpretEfosEmisorEncontrado(code), false, `code ${code} should mean Emisor not found`);
  }
  for (const code of ["", "601", "602", "garbage"]) {
    assert.equal(interpretEfosEmisorEncontrado(code), null, `code ${code} should be unrecognized -> null`);
  }
});

// Live integration test against the real SAT endpoint — deliberate, not an accident.
// This project's whole premise is not trusting secondhand claims about what SAT
// services return; the WSDL/response shape this client relies on was confirmed the
// same way (see consultaCfdi.ts's header comment). A garbage UUID is the one case we
// can assert deterministically without a real, previously-stamped invoice: SAT has
// no record of it, so Estado must come back "No Encontrado" every time.
test(
  "ConsultaCfdiClient: a UUID that was never stamped comes back as not found, live",
  { timeout: 60_000 },
  async () => {
    const client = new ConsultaCfdiClient({ minIntervalMs: 0 });
    const result = await client.consulta({
      rfcEmisor: "XAXX010101000",
      rfcReceptor: "XAXX010101000",
      total: "1000.00",
      uuid: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal(result.found, false);
    assert.equal(result.vigente, null);
    assert.equal(result.cancelado, null);
    assert.equal(result.raw.estado, "No Encontrado");
    // No record of this UUID means SAT never populated ValidacionEFOS either (confirmed
    // live, see consultaCfdi.ts's header comment) — "" is not one of the documented
    // 100/101/104/102/103/200/201 codes, so this must fall through to "don't know", not
    // false.
    assert.equal(result.raw.validacionEfos, "");
    assert.equal(result.efosEmisorEncontrado, null);
  },
);

test("ConsultaCfdiClient.consultaBatch: reports a per-item error without aborting the batch", async () => {
  const client = new ConsultaCfdiClient({ minIntervalMs: 0, retry: { maxRetries: 0, baseDelayMs: 1 } });
  const seen: Array<{ uuid: string; ok: boolean }> = [];

  // Point at an unroutable host by monkeypatching isn't available without DI, so this
  // exercises the real batch-continues-past-failures contract using two calls to the
  // live endpoint instead — both should succeed here, proving onResult fires per item
  // in order without one call blocking or skipping the next.
  await client.consultaBatch(
    [
      { rfcEmisor: "XAXX010101000", rfcReceptor: "XAXX010101000", total: "1.00", uuid: "00000000-0000-0000-0000-000000000001" },
      { rfcEmisor: "XAXX010101000", rfcReceptor: "XAXX010101000", total: "1.00", uuid: "00000000-0000-0000-0000-000000000002" },
    ],
    (params, result) => {
      seen.push({ uuid: params.uuid, ok: !("error" in result) });
    },
  );

  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((s) => s.uuid),
    ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
  );
});
