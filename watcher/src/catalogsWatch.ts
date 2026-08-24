// Catalog source watch + diff. The catalogs.db diff is the heart of the whole watcher:
// everything else (XSD, Anexo 20, 69-B) is a hash comparison; this one must actually
// understand two SQLite databases well enough to say precisely which catalog rows the
// SAT added, removed, or changed -- because that diff is what a rule change PR gets
// drafted from, and an imprecise diff would put invented claims into a fiscal product.
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";
import bz2 from "unbzip2-stream";
import { fetchBuffer, fetchJson } from "./http.ts";

export interface ReleaseInfo {
  tag: string;
  assetUrl: string;
  publishedAt: string | null;
}

interface GhRelease {
  tag_name: string;
  published_at?: string | null;
  assets: { name: string; browser_download_url: string }[];
}

export async function latestCatalogRelease(repo: string, token?: string): Promise<ReleaseInfo> {
  const rel = await fetchJson<GhRelease>(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const asset = rel.assets.find((a) => a.name === "catalogs.db.bz2");
  if (!asset) {
    throw new Error(`Release ${rel.tag_name} of ${repo} has no catalogs.db.bz2 asset -- layout changed upstream, investigate by hand.`);
  }
  return { tag: rel.tag_name, assetUrl: asset.browser_download_url, publishedAt: rel.published_at ?? null };
}

/** Pure-JS bz2 decode (same dependency engine/ already standardized on in its
 *  postinstall) so neither CI nor a bare Windows box needs a bunzip2 binary.
 *
 *  The Buffer.from(view, offset, length) coercion is load-bearing, not style: a PLAIN
 *  Uint8Array passed to Readable.from gets iterated byte-by-byte (each value emitted as
 *  its own "chunk"), which unbzip2-stream then silently decodes to... nothing -- empty
 *  output, no error. A Buffer is emitted as one chunk and decodes correctly. Caught by
 *  catalogDiff.test.ts's round-trip test on the first run; verified both directions
 *  against the same literal bz2 payload. */
export async function decompressBz2(compressed: Uint8Array): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const collect = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });
  await pipeline(Readable.from(Buffer.from(compressed.buffer, compressed.byteOffset, compressed.byteLength)), bz2(), collect);
  return Buffer.concat(chunks);
}

// --- Diff engine -------------------------------------------------------------------------

// node:sqlite returns these per column value; JSON rows normalize every cell to a string
// (or null) so comparisons and narration never trip on bigint vs number.
type RawCell = string | number | bigint | Uint8Array | null;
type JsonRow = Record<string, string | null>;

function normalizeRow(row: Record<string, RawCell>): JsonRow {
  const out: JsonRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null) out[k] = null;
    else if (typeof v === "bigint") out[k] = v.toString();
    else if (v instanceof Uint8Array) out[k] = Buffer.from(v).toString("base64");
    else out[k] = String(v);
  }
  return out;
}

export interface ColumnChange {
  column: string;
  before: string | null;
  after: string | null;
}

export interface RowChange {
  id: string;
  changes: ColumnChange[];
}

export interface TableDiff {
  table: string;
  added: JsonRow[];
  removed: JsonRow[];
  changed: RowChange[];
  columnsBefore: string[];
  columnsAfter: string[];
}

export interface CatalogDiff {
  oldRelease: string;
  newRelease: string;
  tablesCompared: string[];
  unchangedTables: string[];
  newTables: string[];
  droppedTables: string[];
  tables: TableDiff[];
}

export function hasCatalogChanges(diff: CatalogDiff): boolean {
  return (
    diff.newTables.length > 0 ||
    diff.droppedTables.length > 0 ||
    diff.tables.some((t) => t.added.length > 0 || t.removed.length > 0 || t.changed.length > 0)
  );
}

async function loadDbRows(dbPath: string): Promise<Map<string, Map<string, Map<string, string | null>>>> {
  // table -> id -> column -> value
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cfdi_40_%'`)
      .all() as { name: string }[];
    const result = new Map<string, Map<string, Map<string, string | null>>>();
    for (const { name } of tables) {
      const rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, RawCell>[];
      const byId = new Map<string, Map<string, string | null>>();
      for (const row of rows) {
        const normalized = normalizeRow(row);
        const id = normalized.id ?? "";
        byId.set(id, new Map(Object.entries(normalized)));
      }
      result.set(name, byId);
    }
    return result;
  } finally {
    db.close();
  }
}

function columnsOf(byId: Map<string, Map<string, string | null>>): Set<string> {
  // Rows within one table share columns in practice, but scanning them all costs
  // nothing at this scale and catches a mid-table schema surprise loudly.
  const cols = new Set<string>();
  for (const row of byId.values()) for (const c of row.keys()) cols.add(c);
  return cols;
}

/** Full-fidelity row-level diff of every `cfdi_40_%` table between two decompressed
 *  catalogs.db files. Compares ALL columns, not just the five rule-relevant ones --
 *  a watcher that only sees what today's rules read would stay silent about exactly
 *  the upstream changes future rules will need. */
export async function diffCatalogDbs(
  oldDbPath: string,
  oldRelease: string,
  newDbPath: string,
  newRelease: string,
): Promise<CatalogDiff> {
  const [oldTables, newTables] = await Promise.all([loadDbRows(oldDbPath), loadDbRows(newDbPath)]);

  const allTableNames = [...new Set([...oldTables.keys(), ...newTables.keys()])].sort();
  const newOnes = allTableNames.filter((t) => !oldTables.has(t));
  const dropped = allTableNames.filter((t) => !newTables.has(t));

  const diffs: TableDiff[] = [];
  const unchanged: string[] = [];
  for (const table of allTableNames) {
    const before = oldTables.get(table);
    const after = newTables.get(table);
    if (!before || !after) continue;

    const colsBefore = columnsOf(before);
    const colsAfter = columnsOf(after);

    const added: JsonRow[] = [];
    const removed: JsonRow[] = [];
    const changed: RowChange[] = [];

    for (const [id, newRow] of after) {
      const oldRow = before.get(id);
      if (!oldRow) {
        added.push(Object.fromEntries(newRow));
        continue;
      }
      const colChanges: ColumnChange[] = [];
      for (const col of new Set([...oldRow.keys(), ...newRow.keys()])) {
        const b = oldRow.get(col) ?? null;
        const a = newRow.get(col) ?? null;
        if (b !== a) colChanges.push({ column: col, before: b, after: a });
      }
      if (colChanges.length > 0) changed.push({ id, changes: colChanges });
    }
    for (const [id, oldRow] of before) {
      if (!after.has(id)) removed.push(Object.fromEntries(oldRow));
    }

    if (added.length || removed.length || changed.length) {
      diffs.push({
        table,
        added,
        removed,
        changed,
        columnsBefore: [...colsBefore].sort(),
        columnsAfter: [...colsAfter].sort(),
      });
    } else {
      unchanged.push(table);
    }
  }

  return {
    oldRelease,
    newRelease,
    tablesCompared: allTableNames,
    unchangedTables: unchanged,
    newTables: newOnes,
    droppedTables: dropped,
    tables: diffs,
  };
}

/** Downloads both releases' .bz2 assets, decompresses to temp files, diffs. Returns the
 *  diff plus the NEW release's compressed bytes (the caller commits that as the updated
 *  corpus artifact -- no second download). Temp dir is always cleaned up. */
export async function buildCatalogDiff(
  repo: string,
  oldPin: { release: string; assetUrl?: string },
  newRel: ReleaseInfo,
  token?: string,
): Promise<{ diff: CatalogDiff; newBz2: Uint8Array }> {
  const authHeaders: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const oldUrl =
    oldPin.assetUrl ??
    `https://github.com/${repo}/releases/download/${oldPin.release}/catalogs.db.bz2`;

  const [oldBz2, newBz2] = await Promise.all([
    fetchBuffer(oldUrl, { headers: authHeaders }),
    fetchBuffer(newRel.assetUrl, { headers: authHeaders }),
  ]);

  const tmp = await mkdtemp(path.join(tmpdir(), "cfdi-watcher-"));
  try {
    const oldDb = path.join(tmp, "old.db");
    const newDb = path.join(tmp, "new.db");
    await Promise.all([writeFile(oldDb, await decompressBz2(oldBz2)), writeFile(newDb, await decompressBz2(newBz2))]);
    const diff = await diffCatalogDbs(oldDb, oldPin.release, newDb, newRel.tag);
    return { diff, newBz2 };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
