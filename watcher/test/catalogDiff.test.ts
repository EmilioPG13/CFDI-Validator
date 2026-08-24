// Unit tests for the diff engine against two SYNTHETIC catalogs.db files -- no network,
// no corpus dependency. The replay test (replay.test.ts) is where the real historical
// releases get exercised; everything structural is proven here first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { diffCatalogDbs, decompressBz2, hasCatalogChanges } from "../src/catalogsWatch.ts";

async function createDb(dir: string, name: string, seed: (db: DatabaseSync) => void): Promise<string> {
  const p = path.join(dir, name);
  const db = new DatabaseSync(p);
  seed(db);
  db.close();
  return p;
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cfdi-watcher-diff-"));
}

const SEED_BASE = (db: DatabaseSync): void => {
  db.exec(`CREATE TABLE cfdi_40_monedas (id TEXT PRIMARY KEY, vigencia_desde TEXT, vigencia_hasta TEXT, decimales INTEGER)`);
  db.prepare(`INSERT INTO cfdi_40_monedas VALUES ('MXN', '2017-07-01', NULL, 2)`).run();
};

test("identical databases produce an empty diff", async () => {
  const dir = await makeTempDir();
  const a = await createDb(dir, "a.db", SEED_BASE);
  const b = await createDb(dir, "b.db", SEED_BASE);
  const diff = await diffCatalogDbs(a, "v1", b, "v1");
  assert.equal(hasCatalogChanges(diff), false);
  assert.deepEqual(diff.tables, []);
  assert.deepEqual(diff.tablesCompared, ["cfdi_40_monedas"]);
});

test("added, removed, and changed rows are each detected per column", async () => {
  const dir = await makeTempDir();
  const old = await createDb(dir, "old.db", SEED_BASE);
  const neu = await createDb(
    dir,
    "new.db",
    (db) => {
      SEED_BASE(db);
      // changed: EUR gains a vigencia_hasta (retired mid-year)
      db.prepare(`INSERT INTO cfdi_40_monedas VALUES ('EUR', '2017-07-01', '2026-03-13', 2)`).run();
      // added: a new RESICO-style currency entry
      db.prepare(`INSERT INTO cfdi_40_monedas VALUES ('XXX', '2026-03-13', NULL, 0)`).run();
      // removed below via DELETE
      void db;
    },
  );
  const other = await createDb(dir, "old2.db", (db) => {
    SEED_BASE(db);
    db.prepare(`INSERT INTO cfdi_40_monedas VALUES ('USD', '2017-07-01', NULL, 2)`).run();
  });

  // old2 vs new: USD exists only in old (removed), XXX only in new (added),
  // MXN unchanged, EUR changed in old->new? No: old2 lacks EUR too, so EUR counts as ADDED here.
  const diff = await diffCatalogDbs(other, "vOld", neu, "vNew");
  assert.equal(hasCatalogChanges(diff), true);
  const monedas = diff.tables.find((t) => t.table === "cfdi_40_monedas");
  assert.ok(monedas);
  assert.ok(monedas.added.some((r) => r.id === "EUR"));
  assert.ok(monedas.added.some((r) => r.id === "XXX"));
  assert.deepEqual(monedas.removed.map((r) => r.id), ["USD"]);
  assert.equal(monedas.changed.length, 0);

  // Now the precise single-column change case: old -> new where only vigencia_hasta moves.
  const oldWithEur = await createDb(dir, "old3.db", (db) => {
    SEED_BASE(db);
    db.prepare(`INSERT INTO cfdi_40_monedas VALUES ('EUR', '2017-07-01', NULL, 2)`).run();
  });
  const diff2 = await diffCatalogDbs(oldWithEur, "vOld2", neu, "vNew2");
  const m2 = diff2.tables.find((t) => t.table === "cfdi_40_monedas");
  assert.ok(m2);
  assert.deepEqual(
    m2.changed.map((c) => c.id),
    ["EUR"],
  );
  assert.deepEqual(m2.changed[0].changes, [{ column: "vigencia_hasta", before: null, after: "2026-03-13" }]);
});

test("new and dropped cfdi_40_* tables are reported as structural changes", async () => {
  const dir = await makeTempDir();
  const old = await createDb(dir, "old.db", SEED_BASE);
  const neu = await createDb(dir, "new.db", (db) => {
    SEED_BASE(db);
    db.exec(`CREATE TABLE cfdi_40_nueva_tabla (id TEXT PRIMARY KEY, vigencia_desde TEXT, vigencia_hasta TEXT)`);
    db.prepare(`INSERT INTO cfdi_40_nueva_tabla VALUES ('A', '2026-03-13', NULL)`).run();
  });
  const older = await createDb(dir, "older.db", (db) => {
    SEED_BASE(db);
    db.exec(`CREATE TABLE cfdi_40_vieja_tabla (id TEXT PRIMARY KEY, vigencia_desde TEXT, vigencia_hasta TEXT)`);
  });
  const d1 = await diffCatalogDbs(old, "vO", neu, "vN");
  assert.deepEqual(d1.newTables, ["cfdi_40_nueva_tabla"]);
  assert.equal(d1.droppedTables.length, 0);
  assert.equal(hasCatalogChanges(d1), true); // new table alone IS a change

  const d2 = await diffCatalogDbs(older, "vO2", old, "vN2");
  assert.deepEqual(d2.droppedTables, ["cfdi_40_vieja_tabla"]);
});

test("non-cfdi_40_ tables are ignored entirely", async () => {
  const dir = await makeTempDir();
  const mk = async (extra: boolean): Promise<string> =>
    createDb(dir, `x${String(extra)}.db`, (db) => {
      SEED_BASE(db);
      db.exec(`CREATE TABLE otra_tabla (id TEXT PRIMARY KEY)`);
      if (extra) db.prepare(`INSERT INTO otra_tabla VALUES ('nuevo')`).run();
    });
  const a = await mk(false);
  const b = await mk(true);
  const diff = await diffCatalogDbs(a, "v1", b, "v2");
  assert.equal(hasCatalogChanges(diff), false);
});

test("decompressBz2 round-trips bytes produced by an external compressor equivalent", async () => {
  // A tiny hardcoded bz2 stream containing "hello watcher\n" (generated once with
  // Python's bz2.compress; kept literal so this test needs no bunzip2 binary either).
  const bz2Bytes = Uint8Array.from(
    Buffer.from(
      "QlpoOTFBWSZTWcDRbDAAAANRgAAQQAAqRJSAIAAiJpg09QgGmmhINalozhwu5IpwoSGBothg",
      "base64",
    ),
  );
  const out = await decompressBz2(bz2Bytes);
  assert.equal(out.toString("utf-8"), "hello watcher\n");
});
