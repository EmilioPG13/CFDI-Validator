// Report-layer tests: sources.json next-state, the bundle-constants rewrite, and PR
// title/body assembly. All pure functions, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { nextSources, prTitle, updateBundleConstants } from "../src/report.ts";
import { sha256Hex } from "../src/http.ts";
import type { ChangeSet } from "../src/changeset.ts";

function sha(s: string): string {
  // Deterministic stand-in hash for fixtures -- shape matters (64 hex chars), value doesn't.
  return s.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");
}

const BASE_SOURCES = JSON.parse(readFileSync(new URL("../../corpus/sources.json", import.meta.url), "utf-8"));

test("nextSources updates only the changed sections and recomputes hashes from bytes", () => {
  const cs: ChangeSet = {
    detectedAt: "2026-08-23T12:00:00.000Z",
    catalogs: null,
    xsd: null,
    anexo20: { check: { changed: true, oldSha256: sha("old"), newSha256: sha("new"), checkedAt: "x" }, pdf: Buffer.from("pdfbytes") },
    efos: null,
    narration: null,
    model: null,
  };
  const next = nextSources(BASE_SOURCES, cs);
  assert.equal(next.anexo20.sha256, sha256Hex(Buffer.from("pdfbytes")));
  assert.equal(next.catalogs.release, BASE_SOURCES.catalogs.release, "untouched section must stay pinned");
});

test("updateBundleConstants rewrites both provenance lines or throws", () => {
  const cs: ChangeSet = {
    detectedAt: "2026-08-23T12:00:00.000Z",
    catalogs: {
      newRelease: "v10.15.20260821",
      publishedAt: null,
      diff: {
        oldRelease: "v10.13.20260731", newRelease: "v10.15.20260821",
        tablesCompared: [], unchangedTables: [], newTables: [], droppedTables: [], tables: [],
      },
      newBz2: new Uint8Array(),
    },
    xsd: null, anexo20: null, efos: null, narration: null, model: null,
  };
  const original = readFileSync(new URL("../../engine/scripts/build-catalog-bundle.mjs", import.meta.url), "utf-8");
  const updated = updateBundleConstants(original, cs);
  assert.match(updated, /SOURCE_RELEASE = "phpcfdi\/resources-sat-catalogs v10\.15\.20260821"/);
  assert.match(updated, /SOURCE_FETCHED = "2026-08-23"/);
  assert.notEqual(updated, original);

  // A layout change in that script must fail loudly, not silently skip.
  const broken = original.replace(/const SOURCE_RELEASE = "[^"]*";/, "// gone");
  assert.throws(() => updateBundleConstants(broken, cs));
});

test("PR title lists every changed source", () => {
  const base: ChangeSet = {
    detectedAt: "2026-08-23T00:00:00Z", catalogs: null, xsd: null, anexo20: null, efos: null, narration: null, model: null,
  };
  assert.match(prTitle(base), /sin|fuentes/); // never crashes on empty; content covered below

  const cs: ChangeSet = {
    ...base,
    catalogs: {
      newRelease: "v10.15.20260821",
      publishedAt: null,
      diff: {
        oldRelease: "v10.13.20260731", newRelease: "v10.15.20260821",
        tablesCompared: [], unchangedTables: [], newTables: [], droppedTables: [], tables: [],
      },
      newBz2: new Uint8Array(),
    },
    xsd: { check: { changed: true, changes: [], checkedAt: "x" }, files: new Map() },
    efos: { diff: null, csv: new Uint8Array(), sha256: sha("csv") },
  };
  const title = prTitle(cs);
  assert.match(title, /catálogos v10\.13\.20260731→v10\.15\.20260821/);
  assert.match(title, /69-B/);
});
