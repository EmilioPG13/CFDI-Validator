// Designed directly against cv-tailor's own documented bug (CLAUDE.md's Phase 5 plan,
// "Settings resolver" section): getSettings() there merges a DB row over a fallback with
// a bare Object.assign-style spread and returns a plain value with NO provenance -- a
// caller can't tell stored from default. Its cache invalidates on write, but only via one
// convention-based call site nothing enforces.
//
// Three structural fixes here, each mapped to one requirement from the plan:
//   1. resolveSetting() can never return a bare T -- SettingResolution<T> is the only
//      return type, so provenance isn't optional to check.
//   2. resetSetting() DELETES the row -- there is no code path where defaultValue is ever
//      passed to repo.upsert. Writing the default back in would silently recreate the
//      exact footgun cv-tailor still has.
//   3. Cache invalidation lives INSIDE writeSetting/resetSetting, not in the caller -- so
//      a future second write path can't forget it. And there IS no second write path,
//      by construction: writeSetting/resetSetting are the only two functions in this
//      backend permitted to touch AppSetting rows (enforced by
//      test/settingsResolverEnforcement.test.ts, not just this comment).
import { prismaSettingsRepo, type SettingsRepo } from "./repo.ts";
import { sharedSettingsCache, type SettingsCache } from "./cache.ts";

export interface SettingResolution<T> {
  value: T;
  source: "stored" | "default";
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function resolveSetting<T>(
  key: string,
  defaultValue: T,
  repo: SettingsRepo = prismaSettingsRepo,
  cache: SettingsCache = sharedSettingsCache,
): Promise<SettingResolution<T>> {
  const cached = cache.get(key);
  if (cached) return cached as SettingResolution<T>;

  const row = await repo.findByKey(key);
  const resolution: SettingResolution<T> = row
    ? { value: row.value as T, source: "stored", updatedAt: row.updatedAt, updatedBy: row.updatedBy }
    : { value: defaultValue, source: "default", updatedAt: null, updatedBy: null };

  cache.set(key, resolution as SettingResolution<unknown>);
  return resolution;
}

/** The ONLY sanctioned way to write an AppSetting row anywhere in this codebase. */
export async function writeSetting(
  key: string,
  value: unknown,
  updatedBy: string,
  repo: SettingsRepo = prismaSettingsRepo,
  cache: SettingsCache = sharedSettingsCache,
): Promise<void> {
  await repo.upsert(key, value, updatedBy);
  // Invalidation lives HERE, inside the write function itself -- not left for the caller
  // to remember, which is exactly the gap in cv-tailor's own admin.js PUT handler.
  cache.invalidate(key);
}

/** The ONLY sanctioned way to reset a setting. DELETES the row -- never writes
 *  defaultValue back into storage. */
export async function resetSetting(
  key: string,
  repo: SettingsRepo = prismaSettingsRepo,
  cache: SettingsCache = sharedSettingsCache,
): Promise<void> {
  await repo.delete(key);
  cache.invalidate(key);
}
