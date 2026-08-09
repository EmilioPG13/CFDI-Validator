// Zero DB/network dependency -- uses an in-memory fake SettingsRepo (same
// dependency-injection seam PipelineDeps and consulta-sat.ts's injected consultaFn
// already use elsewhere in this repo), not the real Prisma-backed one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSetting, writeSetting, resetSetting } from "../src/settings/resolver.ts";
import { SettingsCache } from "../src/settings/cache.ts";
import type { SettingsRepo, StoredSetting } from "../src/settings/repo.ts";

function fakeRepo(): SettingsRepo & { rows: Map<string, StoredSetting> } {
  const rows = new Map<string, StoredSetting>();
  return {
    rows,
    async findByKey(key) {
      return rows.get(key) ?? null;
    },
    async upsert(key, value, updatedBy) {
      rows.set(key, { value, updatedAt: new Date(), updatedBy });
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

test("resolveSetting: absent row resolves to the default with source 'default'", async () => {
  const repo = fakeRepo();
  const cache = new SettingsCache();
  const resolution = await resolveSetting("model.explainer", "meta/llama-3.1-8b-instruct", repo, cache);
  assert.equal(resolution.source, "default");
  assert.equal(resolution.value, "meta/llama-3.1-8b-instruct");
  assert.equal(resolution.updatedAt, null);
  assert.equal(resolution.updatedBy, null);
});

test("resolveSetting: a stored row wins over the default, with source 'stored'", async () => {
  const repo = fakeRepo();
  const cache = new SettingsCache();
  await writeSetting("model.explainer", "mistralai/mistral-medium-3.5-128b", "admin-1", repo, cache);

  const resolution = await resolveSetting("model.explainer", "meta/llama-3.1-8b-instruct", repo, cache);
  assert.equal(resolution.source, "stored");
  assert.equal(resolution.value, "mistralai/mistral-medium-3.5-128b");
  assert.equal(resolution.updatedBy, "admin-1");
});

test("writeSetting: a write is reflected on the very next read, not after a TTL", async () => {
  const repo = fakeRepo();
  const cache = new SettingsCache();
  // Prime the cache with the default first.
  const before = await resolveSetting("model.verifier", "deepseek-ai/deepseek-v4-flash", repo, cache);
  assert.equal(before.source, "default");

  await writeSetting("model.verifier", "nvidia/llama-3.3-nemotron-super-49b-v1.5", "admin-1", repo, cache);

  const after = await resolveSetting("model.verifier", "deepseek-ai/deepseek-v4-flash", repo, cache);
  assert.equal(after.source, "stored");
  assert.equal(after.value, "nvidia/llama-3.3-nemotron-super-49b-v1.5");
});

test("resetSetting: DELETES the underlying row -- this is the whole point of the test, not that the value equals the default", async () => {
  const repo = fakeRepo();
  const cache = new SettingsCache();
  await writeSetting("model.explainer", "mistralai/mistral-medium-3.5-128b", "admin-1", repo, cache);
  assert.ok(repo.rows.has("model.explainer"), "sanity: row exists before reset");

  await resetSetting("model.explainer", repo, cache);

  // The row must be GONE, not merely equal to the default -- a test that only checked
  // the resolved value would pass even if resetSetting silently wrote the default back
  // in (recreating cv-tailor's exact footgun: a stored row that then blocks future code
  // changes to the default from ever propagating).
  assert.equal(await repo.findByKey("model.explainer"), null);
  assert.equal(repo.rows.has("model.explainer"), false);

  const resolution = await resolveSetting("model.explainer", "meta/llama-3.1-8b-instruct", repo, cache);
  assert.equal(resolution.source, "default");
});

test("resetSetting: resetting an already-absent key does not throw", async () => {
  const repo = fakeRepo();
  const cache = new SettingsCache();
  await assert.doesNotReject(resetSetting("never.written", repo, cache));
});
