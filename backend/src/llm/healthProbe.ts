// NOT a ping. The plan is explicit: what matters before putting a model on a role is
// whether it honors response_format:json_schema -- a model that silently replies in
// prose instead breaks the Explainer/Verifier pipeline with no error anywhere else in
// the system. One call, one model, no loop over the catalog -- invoked from exactly one
// admin button click ("Probar salud"), reusing the SAME rate-limited provider every other
// call goes through (rateLimitedProvider.ts), so the 40 RPM ceiling is a non-issue by
// construction. Deliberately written as a reusable, single-sample primitive so a future
// benchmark harness can loop it over many models -- the loop belongs to that harness, not
// here.
import { prisma } from "../prismaClient.ts";
import type { LlmProvider, JsonSchemaSpec } from "./provider.ts";

// EXPLAINER | VERIFIER only -- Auditor/Catalog Watcher are Phase 6+. A local string-union
// type, not an import of Prisma's generated LlmRole, so this module doesn't need
// @prisma/client just to describe a role -- the Prisma-backed repo below is the only
// place that actually touches the database, and Prisma's schema-DSL-generated enums are
// plain string-literal unions at the type level, so this is structurally assignable
// either direction without a cast.
export type LlmRoleName = "EXPLAINER" | "VERIFIER";

export interface HealthProbeResult {
  reachable: boolean;
  supportsJsonSchema: boolean;
  latencyMs: number | null;
  spanishOk: boolean | null;
  sample: string | null;
  error: string | null;
  /** Not persisted on ModelHealthCheck (that table only tracks last-known health, not
   *  cost) -- surfaced so the caller (routes/admin/health.ts) can log an LlmCall row.
   *  null on an unreachable/errored probe. */
  usage: { promptTokens: number; completionTokens: number } | null;
}

const PROBE_SCHEMA: JsonSchemaSpec = {
  name: "health_probe",
  schema: {
    type: "object",
    properties: { saludo: { type: "string" } },
    required: ["saludo"],
    additionalProperties: false,
  },
};

/** Deliberately simple -- a single-shot heuristic (accented vowels, ñ, a small stopword
 *  list), not a language-detection library. Good enough for a one-sample probe; an
 *  acceptable, known limitation, not something worth over-engineering for this purpose. */
function looksSpanish(text: string): boolean {
  const spanishSignal = /[áéíóúñ¿¡]/i;
  const spanishStopwords = /\b(el|la|los|las|de|que|un|una|es|en|con|para|hola|buen[oa]s?)\b/i;
  return spanishSignal.test(text) || spanishStopwords.test(text);
}

export async function runHealthProbe(provider: LlmProvider, modelId: string): Promise<HealthProbeResult> {
  const started = Date.now();
  try {
    const result = await provider.chatCompletion({
      model: modelId,
      messages: [
        { role: "system", content: "Responde únicamente en español." },
        { role: "user", content: "Responde con un saludo breve en español." },
      ],
      jsonSchema: PROBE_SCHEMA,
      maxTokens: 200,
    });

    const saludo = (result.data as { saludo?: string } | null)?.saludo ?? null;
    return {
      reachable: true,
      // Both conditions matter: the provider must have actually used json_schema mode
      // (not silently fallen back to json_object) AND the parsed field must be present --
      // a model that "used" json_schema mode but still returned garbage doesn't count.
      supportsJsonSchema: result.usedJsonSchemaMode && saludo !== null,
      latencyMs: Date.now() - started,
      spanishOk: saludo !== null ? looksSpanish(saludo) : null,
      sample: saludo,
      error: null,
      usage: result.usage,
    };
  } catch (err) {
    return {
      reachable: false,
      supportsJsonSchema: false,
      latencyMs: Date.now() - started,
      spanishOk: null,
      sample: null,
      error: err instanceof Error ? err.message : String(err),
      usage: null,
    };
  }
}

// --- Persistence + the enforced gate ---------------------------------------------------

export interface ModelHealthRepo {
  /** Latest-only per (modelId, role) -- "last-known health," not an append-only history. */
  upsert(modelId: string, role: LlmRoleName, result: HealthProbeResult): Promise<void>;
  findLatest(modelId: string, role: LlmRoleName): Promise<HealthProbeResult | null>;
}

export const prismaModelHealthRepo: ModelHealthRepo = {
  async upsert(modelId, role, result) {
    // usage isn't a ModelHealthCheck column (that table only tracks last-known health,
    // not cost) -- explicitly excluded from what gets persisted here rather than spread
    // wholesale, so an extra HealthProbeResult field never silently breaks this write.
    const { reachable, supportsJsonSchema, latencyMs, spanishOk, sample, error } = result;
    const row = { reachable, supportsJsonSchema, latencyMs, spanishOk, sample, error };
    await prisma.modelHealthCheck.upsert({
      where: { modelId_role: { modelId, role: role as never } },
      create: { modelId, role: role as never, ...row },
      update: { ...row, checkedAt: new Date() },
    });
  },
  async findLatest(modelId, role) {
    const row = await prisma.modelHealthCheck.findUnique({
      where: { modelId_role: { modelId, role: role as never } },
    });
    if (!row) return null;
    return {
      reachable: row.reachable,
      supportsJsonSchema: row.supportsJsonSchema,
      latencyMs: row.latencyMs,
      spanishOk: row.spanishOk,
      sample: row.sample,
      error: row.error,
      usage: null, // not persisted -- see the upsert() comment above
    };
  },
};

/** Thrown when the latest health check for (modelId, role) doesn't show
 *  supportsJsonSchema: true (including "never checked at all"). Distinct type so route
 *  handlers can map it to a clean 400. */
export class ModelNotHealthyError extends Error {
  constructor(modelId: string, role: LlmRoleName) {
    super(
      `Model "${modelId}" has not been verified to support response_format:json_schema ` +
        `for role ${role}. Run "Probar salud" for this model/role before assigning it.`,
    );
    this.name = "ModelNotHealthyError";
  }
}

/** The enforced gate, not just a UI hint: assigning a model to model.explainer/
 *  model.verifier must go through this first. Called from routes/admin/settings.ts. */
export async function assertModelHealthyForRole(
  modelId: string,
  role: LlmRoleName,
  repo: ModelHealthRepo = prismaModelHealthRepo,
): Promise<void> {
  const latest = await repo.findLatest(modelId, role);
  if (!latest || !latest.supportsJsonSchema) {
    throw new ModelNotHealthyError(modelId, role);
  }
}
