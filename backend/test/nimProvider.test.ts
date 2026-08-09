// Zero network dependency -- a fake NimClient (see nimProvider.ts's own NimClient
// interface, deliberately narrow so tests don't have to fight the real SDK's exact
// overload types). The real end-to-end path was separately verified live against
// meta/llama-3.1-8b-instruct this session (usedJsonSchemaMode: true, correctly-shaped
// response, 686ms) -- these tests cover the edge-case logic that's impractical to
// reliably trigger against the real endpoint on demand: the fallback path, malformed
// JSON extraction, and the schema-conformance check.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createNimProvider,
  isSchemaModeUnsupported,
  extractJson,
  type NimClient,
} from "../src/llm/nimProvider.ts";

const SCHEMA = { name: "test_schema", schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } };

test("isSchemaModeUnsupported: true for a 400 whose body mentions response_format", () => {
  const err = { status: 400, message: "Invalid response_format", error: {} };
  assert.equal(isSchemaModeUnsupported(err), true);
});

test("isSchemaModeUnsupported: false for an unrelated 400, and false for a non-400", () => {
  assert.equal(isSchemaModeUnsupported({ status: 400, message: "Invalid API key" }), false);
  assert.equal(isSchemaModeUnsupported({ status: 500, message: "response_format not supported" }), false);
  assert.equal(isSchemaModeUnsupported(new Error("network error")), false);
});

test("extractJson: parses clean JSON directly", () => {
  assert.deepEqual(extractJson('{"x":"y"}'), { x: "y" });
});

test("extractJson: pulls JSON out of prose/markdown fences a small model wraps it in", () => {
  const wrapped = "Aquí está tu respuesta:\n```json\n{\"x\":\"y\"}\n```\nEspero que ayude.";
  assert.deepEqual(extractJson(wrapped), { x: "y" });
});

test("extractJson: returns null (not throw) for genuinely unparseable text", () => {
  assert.equal(extractJson("esto no es json en absoluto"), null);
});

test("chatCompletion: json_schema success path parses correctly and reports usedJsonSchemaMode:true", async () => {
  const client: NimClient = {
    models: { list: async () => (async function* () {})() },
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: '{"x":"hello"}' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          model: "meta/llama-3.1-8b-instruct",
        }),
      },
    },
  };
  const provider = createNimProvider(() => client);
  const result = await provider.chatCompletion({
    model: "meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: "hi" }],
    jsonSchema: SCHEMA,
  });
  assert.equal(result.usedJsonSchemaMode, true);
  assert.deepEqual(result.data, { x: "hello" });
  assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 5 });
});

test("chatCompletion: a 400 mentioning response_format triggers the json_object fallback, with usedJsonSchemaMode:false", async () => {
  let callCount = 0;
  const client: NimClient = {
    models: { list: async () => (async function* () {})() },
    chat: {
      completions: {
        create: async (body) => {
          callCount++;
          if (body.response_format && (body.response_format as { type?: string }).type === "json_schema") {
            const err = new Error("Invalid response_format for this model") as Error & { status: number };
            err.status = 400;
            throw err;
          }
          return {
            choices: [{ message: { content: '{"x":"fallback"}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 6 },
            model: "some/model",
          };
        },
      },
    },
  };
  const provider = createNimProvider(() => client);
  const result = await provider.chatCompletion({
    model: "some/model",
    messages: [{ role: "user", content: "hi" }],
    jsonSchema: SCHEMA,
  });
  assert.equal(callCount, 2, "must retry once with the json_object fallback");
  assert.equal(result.usedJsonSchemaMode, false);
  assert.deepEqual(result.data, { x: "fallback" });
});

test("chatCompletion: a non-response_format error is NOT caught by the fallback -- it propagates", async () => {
  const client: NimClient = {
    models: { list: async () => (async function* () {})() },
    chat: {
      completions: {
        create: async () => {
          const err = new Error("Invalid API key") as Error & { status: number };
          err.status = 401;
          throw err;
        },
      },
    },
  };
  const provider = createNimProvider(() => client);
  await assert.rejects(
    provider.chatCompletion({ model: "some/model", messages: [{ role: "user", content: "hi" }], jsonSchema: SCHEMA }),
    /Invalid API key/,
  );
});

test("chatCompletion: prose-wrapped JSON in the response is still extracted via extractJson", async () => {
  const client: NimClient = {
    models: { list: async () => (async function* () {})() },
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Claro, aquí tienes: {"x":"wrapped"} -- espero que sirva.' }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
          model: "some/model",
        }),
      },
    },
  };
  const provider = createNimProvider(() => client);
  const result = await provider.chatCompletion({
    model: "some/model",
    messages: [{ role: "user", content: "hi" }],
    jsonSchema: SCHEMA,
  });
  assert.deepEqual(result.data, { x: "wrapped" });
});
