// Zero DB/network dependency -- fake LlmProvider and fake ModelCatalogRepo, same DI seam
// settings/resolver.ts already uses.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  assertModelAllowed,
  getModelCatalog,
  ModelNotAllowedError,
  resetModelCatalogMemoryCache,
  type ModelCatalogRepo,
} from "../src/llm/modelCatalog.ts";
import type { LlmProvider, ModelInfo } from "../src/llm/provider.ts";

const CATALOG: ModelInfo[] = [
  { id: "meta/llama-3.1-8b-instruct", raw: {} },
  { id: "mistralai/mistral-medium-3.5-128b", raw: {} },
];

function fakeProvider(listCalls: { count: number }): LlmProvider {
  return {
    name: "fake",
    async listModels() {
      listCalls.count++;
      return CATALOG;
    },
    async chatCompletion() {
      throw new Error("not used in this test");
    },
  };
}

function fakeRepo(): ModelCatalogRepo & { rows: { models: ModelInfo[]; fetchedAt: Date }[] } {
  const rows: { models: ModelInfo[]; fetchedAt: Date }[] = [];
  return {
    rows,
    async findLatest() {
      return rows.length ? rows[rows.length - 1] : null;
    },
    async create(models) {
      rows.push({ models, fetchedAt: new Date() });
    },
  };
}

beforeEach(() => {
  resetModelCatalogMemoryCache();
});

test("assertModelAllowed: an id present in the cached catalog does not throw", async () => {
  const listCalls = { count: 0 };
  const provider = fakeProvider(listCalls);
  const repo = fakeRepo();
  await assert.doesNotReject(assertModelAllowed("meta/llama-3.1-8b-instruct", provider, repo));
});

test("assertModelAllowed: an id absent from the cached catalog is rejected before any upstream call is built", async () => {
  const listCalls = { count: 0 };
  const provider = fakeProvider(listCalls);
  const repo = fakeRepo();

  await assert.rejects(
    assertModelAllowed("totally-made-up/not-a-real-model", provider, repo),
    ModelNotAllowedError,
  );
});

test("getModelCatalog: does not call the provider on every invocation -- caches in-memory", async () => {
  const listCalls = { count: 0 };
  const provider = fakeProvider(listCalls);
  const repo = fakeRepo();

  await getModelCatalog(false, provider, repo);
  await getModelCatalog(false, provider, repo);
  await getModelCatalog(false, provider, repo);

  assert.equal(listCalls.count, 1, "the NIM catalog must be fetched at most once across repeated calls");
});

test("getModelCatalog: force refresh does call the provider again", async () => {
  const listCalls = { count: 0 };
  const provider = fakeProvider(listCalls);
  const repo = fakeRepo();

  await getModelCatalog(false, provider, repo);
  await getModelCatalog(true, provider, repo);

  assert.equal(listCalls.count, 2);
});

test("getModelCatalog: a cold process (empty memory cache) falls back to the persisted row before hitting NIM", async () => {
  const listCalls = { count: 0 };
  const provider = fakeProvider(listCalls);
  const repo = fakeRepo();
  await repo.create(CATALOG); // simulate a row already persisted from a prior process

  resetModelCatalogMemoryCache();
  const { models } = await getModelCatalog(false, provider, repo);

  assert.equal(listCalls.count, 0, "should read the persisted row, not call NIM, when one already exists");
  assert.deepEqual(models, CATALOG);
});
