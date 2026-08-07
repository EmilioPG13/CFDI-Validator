import type { CatalogRow, CatalogSource } from "./catalogTypes.ts";

/**
 * Browser-side counterpart to `SatCatalogs` (catalogs.ts, node:sqlite-backed) — same
 * `CatalogSource` interface, same `vigencia_desde`/`vigencia_hasta` window semantics,
 * but backed by a small precomputed JSON bundle instead of a 97 MB SQLite file.
 *
 * Why a JSON bundle and not SQLite-in-WASM (sql.js / wa-sqlite): `SatCatalogs` has
 * exactly one query shape — `findVigente(table, id, asOfDate)`, a point lookup by id
 * with a date-range filter, never an arbitrary SQL query (see catalogs.ts's own doc
 * comment: `table` is always a hardcoded literal from rule code, never user input).
 * Rules only ever touch 5 tables (verified by grepping every `catalogs.findVigente(`
 * call site in engine/src/rules/ before writing this): cfdi_40_monedas,
 * cfdi_40_codigos_postales, cfdi_40_usos_cfdi, cfdi_40_productos_servicios,
 * cfdi_40_claves_unidades — and of those tables' columns, rules read only a handful
 * (decimales for monedas; regimenes_fiscales_receptores for usos_cfdi; nothing beyond
 * id/vigencia for the other three, which only ever check existence). A general-purpose
 * WASM SQL engine to serve a single indexed point-lookup is the wrong tool: it means
 * shipping a SQL parser/planner to the browser and initializing a whole database
 * runtime for a query pattern a plain `Map` already answers in O(1). Measured directly
 * against the real catalogs.db (2026-08-06, this session) with only the columns rules
 * actually read: ~9.5 MB raw JSON / ~0.4 MB gzip for all 5 tables combined — see
 * engine/scripts/build-catalog-bundle.mjs, which produces exactly this trimmed shape.
 *
 * vigencia_hasta is, as of this catalogs.db snapshot, empty ("") for every row in
 * every one of these 5 tables except cfdi_40_monedas — meaning most `findVigente`
 * calls in practice degrade to a plain id lookup today. The date-window check is kept
 * here anyway, exactly as SatCatalogs does it, because the SAT *can* start populating
 * vigencia_hasta at any time (a catalog key being retired) and this must keep working
 * correctly on that day without another rewrite — see claveprodserv-claveunidad-vigente
 * and domicilio-fiscal-receptor-cp-existe's own registry.json notes on this same point.
 */

/** The exact JSON shape `build-catalog-bundle.mjs` emits per table: an array of rows,
 *  each already trimmed to only the columns some rule actually reads (plus id/vigencia,
 *  always kept). Loading code for `BrowserCatalogs` takes this shape directly — do not
 *  reintroduce a dependency on the full catalogs.db row shape here, that defeats the
 *  entire point of trimming at build time. */
export type CatalogBundle = Record<string, CatalogRow[]>;

export class BrowserCatalogs implements CatalogSource {
  private readonly byTable: Map<string, Map<string, CatalogRow[]>>;

  /**
   * @param bundle Parsed JSON matching `CatalogBundle` — the caller fetches/imports
   *   the actual bytes (a Vite static asset, a `fetch()` response, whatever the
   *   frontend's loading strategy is); this class only knows about already-parsed data,
   *   same separation of concerns as `SatCatalogs` not knowing how `dbPath` was chosen.
   */
  constructor(bundle: CatalogBundle) {
    this.byTable = new Map();
    for (const [table, rows] of Object.entries(bundle)) {
      const byId = new Map<string, CatalogRow[]>();
      for (const row of rows) {
        const existing = byId.get(row.id);
        if (existing) {
          existing.push(row);
        } else {
          byId.set(row.id, [row]);
        }
      }
      this.byTable.set(table, byId);
    }
  }

  /**
   * Same contract as `SatCatalogs.findVigente`: the row from `table` whose id matches
   * and whose vigencia window covers `asOfDate`. Grouping by id at construction time
   * (see constructor) means a lookup here is an O(1) Map get plus a linear scan over
   * however many rows share that id — currently always 0 or 1 per the "vigencia_hasta
   * is empty today" note above, but written to handle more than one correctly (e.g. a
   * key retired and later reissued) rather than assuming today's data shape forever.
   */
  findVigente<T extends CatalogRow = CatalogRow>(table: string, id: string, asOfDate: string): T | undefined {
    const rows = this.byTable.get(table)?.get(id);
    if (!rows) return undefined;
    return rows.find(
      (row) => row.vigencia_desde <= asOfDate && (row.vigencia_hasta === "" || row.vigencia_hasta >= asOfDate),
    ) as T | undefined;
  }
}
