// Replay verification against REAL historical phpcfdi releases -- the plan's mandatory
// Phase 6 check ("replay a real historical SAT catalog update and assert it produces the
// correct diff"). Expectations below are PINNED TO OBSERVED REALITY: each pair was run
// once by hand and its actual diff recorded here, so these assertions prove the engine
// neither fabricates nor misses changes.
//
// Heavy (downloads two ~25 MB .bz2 assets per pair) and network-dependent, so it skips
// unless explicitly requested -- same pattern as jobQueue.test.ts's DATABASE_URL_TEST
// gate:
//
//   RUN_WATCHER_REPLAY=1 node --test --experimental-strip-types test/replay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCatalogDiff } from "../src/catalogsWatch.ts";

const REPO = "phpcfdi/resources-sat-catalogs";
const enabled = process.env.RUN_WATCHER_REPLAY === "1";
const asset = (tag: string) => `https://github.com/${REPO}/releases/download/${tag}/catalogs.db.bz2`;

test("replay v9.51.20260302 -> v9.52.20260313 (Mar 13 2026 publication): no CFDI 4.0 catalog rows changed", { skip: !enabled }, async () => {
  // Observed by hand 2026-08-23: this release pair moves the tag WITHOUT touching any
  // cfdi_40_* table. The correct diff is empty -- this pins that the watcher does not
  // invent changes just because a new release exists.
  const { diff } = await buildCatalogDiff(
    REPO,
    { release: "v9.51.20260302" },
    { tag: "v9.52.20260313", assetUrl: asset("v9.52.20260313"), publishedAt: null },
  );
  assert.ok(diff.tablesCompared.length > 20, "expected to compare the full cfdi_40_* table set");
  assert.deepEqual(diff.newTables, []);
  assert.deepEqual(diff.droppedTables, []);
  assert.deepEqual(diff.tables, []);
});

test("replay v10.13.20260731 -> v10.15.20260821 (current live drift): exactly 3 patentes aduanales added", { skip: !enabled }, async () => {
  // Observed by hand 2026-08-23: 25 tables compared, 24 unchanged, and precisely three
  // added rows in cfdi_40_patentes_aduanales (customs patent codes) -- none of which is
  // among the five tables today's rules read, which is exactly why the watcher diffs
  // every cfdi_40_* table instead of only the rule-relevant ones.
  const { diff } = await buildCatalogDiff(
    REPO,
    { release: "v10.13.20260731" },
    { tag: "v10.15.20260821", assetUrl: asset("v10.15.20260821"), publishedAt: null },
  );
  assert.equal(diff.tablesCompared.length, 25);
  assert.deepEqual(diff.unchangedTables.length, 24);
  assert.deepEqual(diff.tables.map((t) => t.table), ["cfdi_40_patentes_aduanales"]);

  const t = diff.tables[0];
  assert.equal(t.added.length, 3);
  assert.equal(t.removed.length, 0);
  assert.equal(t.changed.length, 0);
  assert.deepEqual(
    t.added.map((r) => ({ id: r.id, desde: r.vigencia_desde })),
    [
      { id: "2022", desde: "2026-07-16" },
      { id: "2060", desde: "2026-07-27" },
      { id: "6176", desde: "2025-05-28" },
    ],
  );
});
