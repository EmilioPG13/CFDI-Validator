// A small in-memory cache for resolved settings. Short TTL (60s, vs. cv-tailor's 5
// minutes) is defense-in-depth only -- every in-app write already invalidates
// synchronously (see resolver.ts's writeSetting/resetSetting), so the TTL exists purely
// to bound staleness from an out-of-band direct DB write (a migration, a manual SQL
// console edit), not as the primary invalidation mechanism.
//
// Correctness note, not yet a problem: this cache is only consistent because Render's
// free tier runs a single process/instance. If this backend is ever horizontally scaled,
// this in-memory cache stops being sufficient on its own -- would need a shared
// invalidation signal (e.g. Postgres LISTEN/NOTIFY) or dropping the cache entirely.
import type { SettingResolution } from "./resolver.ts";

const TTL_MS = 60_000;

interface CacheEntry {
  resolution: SettingResolution<unknown>;
  expiresAt: number;
}

export class SettingsCache {
  private entries = new Map<string, CacheEntry>();

  get(key: string): SettingResolution<unknown> | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.resolution;
  }

  set(key: string, resolution: SettingResolution<unknown>): void {
    this.entries.set(key, { resolution, expiresAt: Date.now() + TTL_MS });
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }
}

export const sharedSettingsCache = new SettingsCache();
