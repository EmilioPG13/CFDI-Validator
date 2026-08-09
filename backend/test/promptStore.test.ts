// Zero DB dependency -- a fake PromptVersionRepo, same DI pattern as
// settingsResolver.test.ts's fake SettingsRepo. What this file exists to prove: the
// runtime guard on activation actually runs (an unsafe body never becomes active), and
// resolveActivePromptBody's fallback behavior matches a fresh install with nothing stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveActivePromptBody,
  createPromptVersion,
  activatePromptVersion,
  deletePromptVersion,
  PromptVersionNotFoundError,
  ActivePromptDeletionError,
} from "../src/prompts/store.ts";
import { PromptStructureError } from "../src/prompts/structuralChecks.ts";
import type { PromptVersionRecord, PromptVersionRepo } from "../src/prompts/repo.ts";

const SAFE_BODY = `REGLAS FACTUALES:
1. No inventes nada.

REGLAS DE REDACCIÓN:
- Sé breve.`;

const UNSAFE_BODY_NO_HEADERS = "Solo un texto sin secciones.";

function fakeRepo(initial: PromptVersionRecord[] = []): PromptVersionRepo & { rows: PromptVersionRecord[] } {
  const rows = [...initial];
  let nextId = 1;
  return {
    rows,
    async listByKey(key) {
      return rows.filter((r) => r.key === key).sort((a, b) => b.version - a.version);
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async findActive(key) {
      return rows.find((r) => r.key === key && r.active) ?? null;
    },
    async create(key, body, createdBy) {
      const maxVersion = rows.filter((r) => r.key === key).reduce((max, r) => Math.max(max, r.version), 0);
      const row: PromptVersionRecord = {
        id: `fake-${nextId++}`,
        key,
        body,
        version: maxVersion + 1,
        active: false,
        createdBy,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async activate(key, id) {
      for (const r of rows) {
        if (r.key === key) r.active = r.id === id;
      }
    },
    async remove(id) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx !== -1) rows.splice(idx, 1);
    },
  };
}

// --- resolveActivePromptBody --------------------------------------------------------------

test("resolveActivePromptBody: no active row -> falls back, source 'fallback', a fresh install behaves identically to before this sub-phase existed", async () => {
  const repo = fakeRepo();
  const resolution = await resolveActivePromptBody("explainer.system", "FALLBACK_BODY", repo);
  assert.equal(resolution.source, "fallback");
  assert.equal(resolution.body, "FALLBACK_BODY");
  assert.equal(resolution.versionId, null);
});

test("resolveActivePromptBody: an active row wins over the fallback, source 'stored'", async () => {
  const repo = fakeRepo([
    { id: "v1", key: "explainer.system", body: SAFE_BODY, version: 1, active: true, createdBy: null, createdAt: new Date() },
  ]);
  const resolution = await resolveActivePromptBody("explainer.system", "FALLBACK_BODY", repo);
  assert.equal(resolution.source, "stored");
  assert.equal(resolution.body, SAFE_BODY);
  assert.equal(resolution.versionId, "v1");
  assert.equal(resolution.version, 1);
});

// --- createPromptVersion --------------------------------------------------------------------

test("createPromptVersion: auto-increments version number per key, independently per key", async () => {
  const repo = fakeRepo();
  const v1 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);
  const v2 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);
  const otherKeyV1 = await createPromptVersion("verifier.system", SAFE_BODY, "admin-1", repo);
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(otherKeyV1.version, 1, "a different key must not share the first key's version counter");
});

test("createPromptVersion: does NOT run assertPromptStructurallySafe -- an admin can save an in-progress draft", async () => {
  const repo = fakeRepo();
  await assert.doesNotReject(() => createPromptVersion("explainer.system", UNSAFE_BODY_NO_HEADERS, "admin-1", repo));
});

// --- activatePromptVersion: the runtime guard ------------------------------------------------

test("activatePromptVersion: rejects a structurally-unsafe body, PromptStructureError, and never calls repo.activate", async () => {
  const repo = fakeRepo();
  const draft = await createPromptVersion("explainer.system", UNSAFE_BODY_NO_HEADERS, "admin-1", repo);
  await assert.rejects(() => activatePromptVersion(draft.id, repo), PromptStructureError);
  assert.equal(repo.rows.find((r) => r.id === draft.id)?.active, false, "unsafe draft must never become active");
});

test("activatePromptVersion: activates a well-formed body and deactivates whatever was previously active for that key", async () => {
  const repo = fakeRepo();
  const v1 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);
  await activatePromptVersion(v1.id, repo);
  const v2 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);

  const activated = await activatePromptVersion(v2.id, repo);

  assert.equal(activated.active, true);
  assert.equal(repo.rows.find((r) => r.id === v1.id)?.active, false, "activating v2 must deactivate v1 -- exactly one active row per key");
  assert.equal(repo.rows.filter((r) => r.key === "explainer.system" && r.active).length, 1);
});

test("activatePromptVersion: an unknown id throws PromptVersionNotFoundError", async () => {
  const repo = fakeRepo();
  await assert.rejects(() => activatePromptVersion("does-not-exist", repo), PromptVersionNotFoundError);
});

// --- deletePromptVersion --------------------------------------------------------------------

test("deletePromptVersion: rejects deleting the currently active version", async () => {
  const repo = fakeRepo();
  const v1 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);
  await activatePromptVersion(v1.id, repo);
  await assert.rejects(() => deletePromptVersion(v1.id, repo), ActivePromptDeletionError);
  assert.ok(repo.rows.some((r) => r.id === v1.id), "the active row must still exist after the rejected delete");
});

test("deletePromptVersion: succeeds for a non-active version", async () => {
  const repo = fakeRepo();
  const v1 = await createPromptVersion("explainer.system", SAFE_BODY, "admin-1", repo);
  await deletePromptVersion(v1.id, repo);
  assert.equal(repo.rows.find((r) => r.id === v1.id), undefined);
});

test("deletePromptVersion: an unknown id throws PromptVersionNotFoundError", async () => {
  const repo = fakeRepo();
  await assert.rejects(() => deletePromptVersion("does-not-exist", repo), PromptVersionNotFoundError);
});
