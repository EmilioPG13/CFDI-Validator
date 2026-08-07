// Regenerates engine/catalog-bundle/ from corpus/catalogs/catalogs.db — the precomputed,
// browser-sized JSON that BrowserCatalogs (../src/catalogsBrowser.ts) loads instead of a
// WASM SQL engine. Chained into postinstall (after ensure-catalogs-db.mjs decompresses
// catalogs.db) rather than committed or run manually — same reasoning catalogs.db itself
// already uses: a generated artifact that's cheap to regenerate (a few seconds) is safer
// gitignored than committed, because committed-but-derived data silently drifts from its
// source the first time someone refreshes catalogs.db and forgets this script exists.
// Phase 6's Catalog Watcher automates the *source* refresh; this keeps the bundle in
// lockstep with whatever catalogs.db is on disk, automatically, on every install.
//
// Column trimming per table is deliberate and hand-picked, not "select *": every column
// kept here is read by at least one rule (verified 2026-08-06 by grepping every
// `catalogs.findVigente(` call site under engine/src/rules/ and tracing which fields of
// the returned row each rule actually reads). Shipping unused columns (e.g.
// cfdi_40_codigos_postales' timezone/huso_* fields, or cfdi_40_productos_servicios'
// `similares`/`texto`) would nearly 5x the bundle for zero functional benefit — measured
// directly: trimmed = ~9.5 MB raw / ~0.4 MB gzip for all 5 tables; untrimmed (every
// column) = ~49 MB raw for the same 5 tables. If a future rule needs a column not listed
// here, add it to that table's SELECT below — don't widen speculatively ahead of an
// actual rule that reads it, same discipline ParsedCfdi's own doc comment already uses.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

// Source provenance — see corpus/README.md for the full fetch history. Update this
// alongside a catalogs.db refresh; there's no version table inside the DB itself to read
// it from automatically (checked 2026-08-06 — no `%version%`/`%meta%` table exists).
const SOURCE_RELEASE = "phpcfdi/resources-sat-catalogs v10.13.20260731";
const SOURCE_FETCHED = "2026-08-04";

const CATALOGS_DB_PATH = path.resolve(import.meta.dirname, "../../corpus/catalogs/catalogs.db");
const OUT_DIR = path.resolve(import.meta.dirname, "../catalog-bundle");

// Same defensive posture as ensure-catalogs-db.mjs: corpus/ may not be fetched yet on a
// fresh clone (e.g. the .bz2 itself is missing) — don't fail the whole `npm install` over
// missing corpus data, just warn and skip. catalogsBrowser.test.ts's own "bundle exists"
// check is where this actually surfaces as a failure, with a clearer error than a crashed
// postinstall would give.
if (!existsSync(CATALOGS_DB_PATH)) {
  console.warn(
    `[build-catalog-bundle] ${CATALOGS_DB_PATH} not found — skipping. ` +
      "Run again after corpus/catalogs/catalogs.db exists (see ensure-catalogs-db.mjs / corpus/README.md).",
  );
  process.exit(0);
}

// table -> extra columns beyond id/vigencia_desde/vigencia_hasta (always kept) that some
// rule actually reads. Keep in sync with engine/src/rules/*.ts's catalogs.findVigente<T>()
// generic row types (MonedaRow, UsoCfdiRow, etc.) — those types ARE this list, expressed
// in TypeScript instead of SQL; if one drifts, so should the other.
const TABLES = {
  // impuestosConceptoRollupConsistencia.ts, impuestosTotalesConsistencia.ts,
  // subtotalDescuentoConceptosSuma.ts, totalComprobanteConsistencia.ts all read
  // `decimales` (MonedaRow) to round arithmetic comparisons correctly per currency.
  cfdi_40_monedas: ["decimales"],
  // domicilioFiscalReceptorCpExiste.ts only checks existence — no extra column read.
  cfdi_40_codigos_postales: [],
  // regimenUsoCompat.ts reads `regimenes_fiscales_receptores` (UsoCfdiRow) — the
  // Régimen×Uso compatibility whitelist is already-curated catalog data, not derived.
  cfdi_40_usos_cfdi: ["regimenes_fiscales_receptores"],
  // claveprodservClaveunidadVigente.ts only checks existence — no extra column read.
  cfdi_40_productos_servicios: [],
  cfdi_40_claves_unidades: [],
};

mkdirSync(OUT_DIR, { recursive: true });

const db = new DatabaseSync(CATALOGS_DB_PATH, { readOnly: true });
const manifest = { sourceRelease: SOURCE_RELEASE, sourceFetched: SOURCE_FETCHED, generatedAt: new Date().toISOString(), tables: {} };

for (const [table, extraCols] of Object.entries(TABLES)) {
  const cols = ["id", "vigencia_desde", "vigencia_hasta", ...extraCols];
  const rows = db.prepare(`SELECT ${cols.join(",")} FROM ${table}`).all();
  const json = JSON.stringify(rows);
  const outPath = path.join(OUT_DIR, `${table}.json`);
  writeFileSync(outPath, json, "utf-8");
  manifest.tables[table] = { rowCount: rows.length, columns: cols, bytes: json.length };
  console.log(`[build-catalog-bundle] ${table}: ${rows.length} rows, ${(json.length / 1024).toFixed(0)} KB -> ${outPath}`);
}

db.close();

writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
const totalBytes = Object.values(manifest.tables).reduce((sum, t) => sum + t.bytes, 0);
console.log(`[build-catalog-bundle] Done. Total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB raw (gzip is roughly 25-40x smaller for this data, see catalogsBrowser.ts).`);
