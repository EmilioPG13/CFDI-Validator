// The ONLY file in this backend permitted to touch the AppSetting table. Enforced by
// test/settingsResolverEnforcement.test.ts, which scans every other file under src/ for
// the literal string "prisma.appSetting" and fails if found -- this is what makes cv-tailor's
// "invalidate on write" a structural guarantee instead of a convention nothing enforces
// (cv-tailor's own invalidateSettingsCache() is only ever called from one route handler;
// nothing stops a second write path from forgetting it -- see CLAUDE.md's Phase 5 plan).
import { prisma } from "../prismaClient.ts";

export interface StoredSetting {
  value: unknown;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SettingsRepo {
  findByKey(key: string): Promise<StoredSetting | null>;
  upsert(key: string, value: unknown, updatedBy: string | null): Promise<void>;
  delete(key: string): Promise<void>;
}

export const prismaSettingsRepo: SettingsRepo = {
  async findByKey(key) {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    if (!row) return null;
    return { value: row.value, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  },

  async upsert(key, value, updatedBy) {
    await prisma.appSetting.upsert({
      where: { key },
      // Prisma's Json scalar requires a NullableJsonNullValueInput/JsonNullValueInput cast
      // to write a literal JSON null vs. a SQL NULL -- value here is always a real JSON
      // value from a validated setting write, never JS `null`, so a plain cast is safe.
      create: { key, value: value as never, updatedBy },
      update: { value: value as never, updatedBy },
    });
  },

  async delete(key) {
    // No-op if already absent -- reset() must not throw just because there was nothing
    // stored to begin with (deleteMany, not delete, sidesteps Prisma's
    // RecordNotFound error on a plain delete()).
    await prisma.appSetting.deleteMany({ where: { key } });
  },
};
