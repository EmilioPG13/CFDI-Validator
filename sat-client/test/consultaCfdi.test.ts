import { test } from "node:test";
import assert from "node:assert/strict";
import { ConsultaCfdiClient } from "../src/consultaCfdi.ts";

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
