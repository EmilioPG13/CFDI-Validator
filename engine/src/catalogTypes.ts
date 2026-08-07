/**
 * `CatalogRow`/`CatalogSource` live in their own file, separate from `catalogs.ts`, for
 * one specific reason discovered in Phase 4e: TypeScript must fully parse+check an
 * ENTIRE source file to resolve even a single `import type` from it — there's no
 * partial-file loading. `catalogs.ts` imports `node:sqlite` at its own top level (needed
 * for `SatCatalogs`, the Node/CLI backend), so ANY file that imports so much as a type
 * from `catalogs.ts` — even a rule file that only ever touches `CatalogSource`, never
 * `SatCatalogs` itself — drags a `node:sqlite` resolution requirement into its own
 * type-checking graph. That's invisible in engine/'s own Node-context typecheck (which
 * has `node` types available), but breaks the moment any of those files get pulled into
 * a browser-context typecheck (frontend/tsconfig.app.json, no `node` types, by design —
 * see that config's own comment on why "node" is deliberately absent there) via
 * `engine/src/pipeline.ts`'s `rules` array import.
 *
 * Every rule file, `rules/index.ts`, `pipeline.ts`, and `catalogsBrowser.ts` import
 * `CatalogRow`/`CatalogSource` from THIS file, not `catalogs.ts` — keeping the
 * `CatalogSource`-typed dependency graph (everything the browser pipeline touches)
 * completely free of `catalogs.ts`'s Node-only import, even transitively.
 * `catalogs.ts` re-exports both for any code that still wants to import them from there.
 */

export interface CatalogRow {
  id: string;
  vigencia_desde: string;
  vigencia_hasta: string;
  [key: string]: unknown;
}

/**
 * The one capability every rule actually needs from a catalog backend. `SatCatalogs`
 * (catalogs.ts, node:sqlite-backed) and `BrowserCatalogs` (catalogsBrowser.ts,
 * JSON-bundle-backed) both implement this and nothing else — no rule has ever called
 * anything but `findVigente` on a catalogs param (verified by grep across
 * engine/src/rules/ during the Phase 4a refactor).
 */
export interface CatalogSource {
  findVigente<T extends CatalogRow = CatalogRow>(table: string, id: string, asOfDate: string): T | undefined;
}
