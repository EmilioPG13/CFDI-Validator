import { DatabaseSync } from "node:sqlite";
import type { CatalogRow, CatalogSource } from "./catalogTypes.ts";

// Re-exported for backward compatibility / anyone importing from this file directly —
// but note every file in the CatalogSource-typed dependency graph that the BROWSER
// pipeline touches (rules/*, rules/index.ts, pipeline.ts, catalogsBrowser.ts) imports
// these from catalogTypes.ts instead, specifically to avoid pulling this file's own
// node:sqlite import into a browser typecheck — see catalogTypes.ts's header comment
// for the full reasoning (a real problem hit and fixed in Phase 4e, not a preemptive
// guess).
export type { CatalogRow, CatalogSource };

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
