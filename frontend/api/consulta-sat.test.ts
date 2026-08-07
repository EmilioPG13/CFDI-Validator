import { test } from "node:test";
import assert from "node:assert/strict";
import { handleConsultaSatRequest, parseConsultaCfdiParams } from "./consulta-sat.ts";
import type { ConsultaCfdiParams, ConsultaCfdiResult } from "../../sat-client/src/consultaCfdi.ts";

// Tests the HTTP-handling wrapper only (method/body validation, response shaping) — NOT
// ConsultaCfdiClient itself, which sat-client/test/ already covers thoroughly (including
// live calls to the real SAT endpoint). Every test here injects a fake consultaFn instead
// of touching the network, per handleConsultaSatRequest's own doc comment.

function fakeResult(overrides: Partial<ConsultaCfdiResult> = {}): ConsultaCfdiResult {
  return {
    raw: { codigoEstatus: "", esCancelable: "", estado: "Vigente", estatusCancelacion: "", validacionEfos: "200" },
    found: true,
    vigente: true,
    cancelado: false,
    efosEmisorEncontrado: false,
    ...overrides,
  };
}

const VALID_PARAMS: ConsultaCfdiParams = {
  rfcEmisor: "XAXX010101000",
  rfcReceptor: "XAXX010101000",
  total: "1000.00",
  uuid: "00000000-0000-0000-0000-000000000000",
};

// --- parseConsultaCfdiParams (pure) --------------------------------------------------

test("parseConsultaCfdiParams: accepts a well-formed body", () => {
  assert.deepEqual(parseConsultaCfdiParams(VALID_PARAMS), VALID_PARAMS);
});

test("parseConsultaCfdiParams: rejects null, non-object, and missing/empty fields", () => {
  assert.equal(parseConsultaCfdiParams(null), null);
  assert.equal(parseConsultaCfdiParams("not an object"), null);
  assert.equal(parseConsultaCfdiParams([1, 2, 3]), null);
  assert.equal(parseConsultaCfdiParams({}), null);
  assert.equal(parseConsultaCfdiParams({ ...VALID_PARAMS, uuid: "" }), null);
  assert.equal(parseConsultaCfdiParams({ ...VALID_PARAMS, total: "   " }), null);
  assert.equal(parseConsultaCfdiParams({ ...VALID_PARAMS, rfcEmisor: undefined }), null);
});

// --- handleConsultaSatRequest (HTTP wrapper) -------------------------------------------

test("handleConsultaSatRequest: OPTIONS preflight returns 204 with CORS headers, never calls consultaFn", async () => {
  let called = false;
  const request = new Request("https://example.com/api/consulta-sat", { method: "OPTIONS" });
  const response = await handleConsultaSatRequest(request, async () => {
    called = true;
    return fakeResult();
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(called, false);
});

test("handleConsultaSatRequest: non-POST/OPTIONS method is rejected with 405", async () => {
  const request = new Request("https://example.com/api/consulta-sat", { method: "GET" });
  const response = await handleConsultaSatRequest(request, async () => fakeResult());
  assert.equal(response.status, 405);
});

test("handleConsultaSatRequest: invalid JSON body is rejected with 400", async () => {
  const request = new Request("https://example.com/api/consulta-sat", {
    method: "POST",
    body: "{not json",
    headers: { "content-type": "application/json" },
  });
  const response = await handleConsultaSatRequest(request, async () => fakeResult());
  assert.equal(response.status, 400);
});

test("handleConsultaSatRequest: missing required fields is rejected with 400, consultaFn never called", async () => {
  let called = false;
  const request = new Request("https://example.com/api/consulta-sat", {
    method: "POST",
    body: JSON.stringify({ rfcEmisor: "XAXX010101000" }),
    headers: { "content-type": "application/json" },
  });
  const response = await handleConsultaSatRequest(request, async () => {
    called = true;
    return fakeResult();
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("handleConsultaSatRequest: valid request calls consultaFn with the parsed params and returns its result as JSON", async () => {
  let receivedParams: ConsultaCfdiParams | undefined;
  const expected = fakeResult({ cancelado: true, vigente: false });
  const request = new Request("https://example.com/api/consulta-sat", {
    method: "POST",
    body: JSON.stringify(VALID_PARAMS),
    headers: { "content-type": "application/json" },
  });
  const response = await handleConsultaSatRequest(request, async (params) => {
    receivedParams = params;
    return expected;
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(receivedParams, VALID_PARAMS);
  assert.deepEqual(await response.json(), expected);
});

test("handleConsultaSatRequest: consultaFn throwing surfaces as 502, not a fabricated 200", async () => {
  const request = new Request("https://example.com/api/consulta-sat", {
    method: "POST",
    body: JSON.stringify(VALID_PARAMS),
    headers: { "content-type": "application/json" },
  });
  const response = await handleConsultaSatRequest(request, async () => {
    throw new Error("SAT endpoint unreachable after retries");
  });
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.match(body.error, /SAT endpoint unreachable/);
});
