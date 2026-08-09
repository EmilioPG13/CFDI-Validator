// Read-side of the LlmCall table. Writes happen inline at each call site instead (see
// jobs/processor.ts's logLlmCall and routes/admin/health.ts's own prisma.llmCall.create) --
// this module is deliberately read-only, backing the admin console's cost-tracking views.
// Token counts only, never a computed dollar figure: NIM's /v1/models response doesn't
// expose per-token pricing (see the Phase 5 plan's own "job/cost views" note), so a
// dollar number here would just be a fabricated one.
import { prisma } from "../prismaClient.ts";

export interface LlmCallListFilter {
  role?: "EXPLAINER" | "VERIFIER";
  purpose?: "PRODUCTION" | "HEALTH_CHECK";
  modelId?: string;
}

export async function listLlmCalls(filter: LlmCallListFilter, limit: number, offset: number) {
  const where = {
    ...(filter.role ? { role: filter.role as never } : {}),
    ...(filter.purpose ? { purpose: filter.purpose as never } : {}),
    ...(filter.modelId ? { modelId: filter.modelId } : {}),
  };
  const [calls, total] = await Promise.all([
    prisma.llmCall.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.llmCall.count({ where }),
  ]);
  return { calls, total };
}

export interface LlmCallTotals {
  modelId: string;
  role: string;
  purpose: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
}

/** Grouped totals across the whole table (not paginated -- the number of distinct
 *  (modelId, role, purpose) combinations is small by construction: 2 roles, 2 purposes,
 *  and however many models have actually been used). Backs the admin console's
 *  cost-tracking summary row above the raw LlmCall list. */
export async function getLlmCallTotals(): Promise<LlmCallTotals[]> {
  const grouped = await prisma.llmCall.groupBy({
    by: ["modelId", "role", "purpose"],
    _count: { _all: true },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return grouped.map((g) => ({
    modelId: g.modelId,
    role: g.role,
    purpose: g.purpose,
    callCount: g._count._all,
    promptTokens: g._sum.promptTokens ?? 0,
    completionTokens: g._sum.completionTokens ?? 0,
  }));
}
