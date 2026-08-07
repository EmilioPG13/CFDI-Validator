import { DatabaseSync } from "node:sqlite";

export interface CatalogRow {
  id: string;
  vigencia_desde: string;
  vigencia_hasta: string;
  [key: string]: unknown;
}

/**
 * The one capability every rule actually needs from a catalog backend — extracted
 * from `SatCatalogs` (Phase 4) so rules can be typed against this instead of the
 * concrete sqlite-backed class. `SatCatalogs` (below, Node/CLI, backed by
 * corpus/catalogs/catalogs.db via node:sqlite) and `BrowserCatalogs`
 * (catalogsBrowser.ts, backed by a precomputed JSON bundle, no WASM SQL engine
 * needed — see that file's header comment for why) both implement this and
 * nothing else; no rule has ever called anything but `findVigente` on a catalogs
 * param (verified by grep across engine/src/rules/ before this refactor — `close()`
 * is a resource-cleanup concern for whoever constructs a SatCatalogs, not something
 * a rule function needs).
 */
export interface CatalogSource {
  findVigente<T extends CatalogRow = CatalogRow>(table: string, id: string, asOfDate: string): T | undefined;
}

/**
 * Thin wrapper over corpus/catalogs/catalogs.db (phpcfdi/resources-sat-catalogs).
 * Centralizes the vigencia_desde/vigencia_hasta window check once, so every rule
 * doesn't reimplement (and potentially get slightly wrong) the same date-range
 * comparison — see corpus/README.md for the table list and what's in each.
 */
export class SatCatalogs implements CatalogSource {
  private db: DatabaseSync;

  /** dbPath must be a real, absolute, Windows-style path — see CLAUDE.md gotchas
   *  on why a POSIX-style /c/... path fails silently-ish here. */
  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  /**
   * Row from `table` whose id matches and whose vigencia window covers asOfDate.
   *
   * `table` is never derived from untrusted input (uploaded CFDI XML never
   * chooses a table name) — always a hardcoded literal from rule code. Do not
   * change that assumption without parameterizing this differently; SQLite
   * doesn't support parameterized identifiers, only values.
   */
  findVigente<T extends CatalogRow = CatalogRow>(
    table: string,
    id: string,
    asOfDate: string,
  ): T | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM ${table} WHERE id = ? AND vigencia_desde <= ? AND (vigencia_hasta = '' OR vigencia_hasta >= ?)`,
      )
      .get(id, asOfDate, asOfDate);
    return row as T | undefined;
  }

  close(): void {
    this.db.close();
  }
}
