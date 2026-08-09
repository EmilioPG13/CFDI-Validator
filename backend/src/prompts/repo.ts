// Prisma-backed CRUD for PromptVersion. Split from store.ts (the business-logic layer)
// so tests can inject a fake repo -- same DI seam this codebase already uses for
// SettingsRepo (settings/repo.ts) and ModelHealthRepo (llm/healthProbe.ts).
import { prisma } from "../prismaClient.ts";

export interface PromptVersionRecord {
  id: string;
  key: string;
  body: string;
  version: number;
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
}

export interface PromptVersionRepo {
  listByKey(key: string): Promise<PromptVersionRecord[]>;
  findById(id: string): Promise<PromptVersionRecord | null>;
  findActive(key: string): Promise<PromptVersionRecord | null>;
  /** Computes the next version number for `key` itself (max existing + 1, or 1 if none
   *  exist yet). NOT made atomic against a concurrent create for the same key -- unlike
   *  jobs/queue.ts's claimPendingJobs (which genuinely needs FOR UPDATE SKIP LOCKED because
   *  concurrent HTTP requests are the normal case there), this is a low-traffic admin
   *  action. A real race just hits the @@unique([key, version]) constraint and throws a
   *  clean Prisma error instead of silently corrupting data. */
  create(key: string, body: string, createdBy: string | null): Promise<PromptVersionRecord>;
  /** Deactivates whatever is currently active for `key`, then activates `id` -- both in one
   *  transaction. The partial unique index (PromptVersion_one_active_per_key, hand-added to
   *  the first migration -- see schema.prisma's own comment on PromptVersion) is the real
   *  backstop guaranteeing "exactly one active row per key"; this transaction is what makes
   *  that the common case, not the only thing enforcing it. */
  activate(key: string, id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const prismaPromptVersionRepo: PromptVersionRepo = {
  async listByKey(key) {
    return prisma.promptVersion.findMany({ where: { key }, orderBy: { version: "desc" } });
  },

  async findById(id) {
    return prisma.promptVersion.findUnique({ where: { id } });
  },

  async findActive(key) {
    return prisma.promptVersion.findFirst({ where: { key, active: true } });
  },

  async create(key, body, createdBy) {
    const latest = await prisma.promptVersion.aggregate({ where: { key }, _max: { version: true } });
    const version = (latest._max.version ?? 0) + 1;
    return prisma.promptVersion.create({ data: { key, body, version, createdBy } });
  },

  async activate(key, id) {
    await prisma.$transaction([
      prisma.promptVersion.updateMany({ where: { key, active: true }, data: { active: false } }),
      prisma.promptVersion.update({ where: { id }, data: { active: true } }),
    ]);
  },

  async remove(id) {
    await prisma.promptVersion.delete({ where: { id } });
  },
};
