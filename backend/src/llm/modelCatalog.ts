// Fetches and caches NVIDIA NIM's /v1/models catalog (~136 entries) -- NEVER fetched on
// every page load, per the Phase 5 plan's explicit constraint. In-memory cache first,
// falling back to the latest persisted ModelCatalog row on a cold process start (so a
// fresh Render dyno waking from sleep doesn't need a live NIM round-trip just to answer
// "is this model id allowed" for an admin request), and only hitting NIM for real on an
// explicit force-refresh or when nothing has ever been cached at all.
//
// provider/repo are injectable (same DI seam as settings/resolver.ts) so
// modelAllowlist.test.ts can assert the allowlist logic with zero live DB/network --
// production code (routes/admin/models.ts) uses the real defaults.
import { prisma } from "../prismaClient.ts";
import { provider as defaultProvider } from "./rateLimitedProvider.ts";
import type { LlmProvider, ModelInfo } from "./provider.ts";

export interface ModelCatalogRepo {
  findLatest(): Promise<{ models: ModelInfo[]; fetchedAt: Date } | null>;
  create(models: ModelInfo[]): Promise<void>;
}

export const prismaModelCatalogRepo: ModelCatalogRepo = {
  async findLatest() {
    const row = await prisma.modelCatalog.findFirst({ orderBy: { fetchedAt: "desc" } });
    if (!row) return null;
    return { models: row.models as unknown as ModelInfo[], fetchedAt: row.fetchedAt };
  },
  async create(models) {
    await prisma.modelCatalog.create({ data: { models: models as unknown as never } });
  },
};

let memoryCache: { models: ModelInfo[]; fetchedAt: Date } | null = null;

/** Exposed for tests only -- production code never needs to reset this mid-process. */
export function resetModelCatalogMemoryCache(): void {
  memoryCache = null;
}

/** The catalog admin console UI reads from. `force: true` is the one path a real NIM
 *  call happens outside of a genuinely cold process -- wired to the admin "force refresh"
 *  button, never called automatically on a page load. */
export async function getModelCatalog(
  force = false,
  provider: LlmProvider = defaultProvider,
  repo: ModelCatalogRepo = prismaModelCatalogRepo,
): Promise<{ models: ModelInfo[]; fetchedAt: Date }> {
  if (!force && memoryCache) return memoryCache;

  if (!force) {
    const latest = await repo.findLatest();
    if (latest) {
      memoryCache = latest;
      return memoryCache;
    }
  }

  const models = await provider.listModels();
  await repo.create(models);
  memoryCache = { models, fetchedAt: new Date() };
  return memoryCache;
}

/** Thrown when a model id isn't in the latest cached catalog. Distinct type so callers
 *  (route handlers) can map it to a clean 400 rather than a generic 500. */
export class ModelNotAllowedError extends Error {
  constructor(modelId: string) {
    super(`Model "${modelId}" is not in the cached NIM catalog. Refresh the catalog or check the id.`);
    this.name = "ModelNotAllowedError";
  }
}

/** Called by every downstream consumer that accepts a model id from an admin-facing form
 *  BEFORE that id reaches an upstream NIM request body -- never let a free-text model
 *  string reach the request directly, per the Phase 5 plan's explicit requirement. */
export async function assertModelAllowed(
  modelId: string,
  provider: LlmProvider = defaultProvider,
  repo: ModelCatalogRepo = prismaModelCatalogRepo,
): Promise<void> {
  const { models } = await getModelCatalog(false, provider, repo);
  if (!models.some((m) => m.id === modelId)) {
    throw new ModelNotAllowedError(modelId);
  }
}
