// Typed client for the Phase 5 backend (Express, a genuinely separate origin -- Render in
// production, http://localhost:3001 in dev; NOT a same-origin Vercel function like
// /api/consulta-sat in audit.ts). Types here are hand-mirrored from backend/src's own
// response shapes rather than imported from there directly -- backend/ is a Node server
// (imports @prisma/client, express, etc.), and importing even a `type`-only reference
// from it risks the exact "TypeScript must fully parse the whole file to resolve one
// import type" trap CLAUDE.md documents for engine/catalogs.ts vs catalogTypes.ts.
// Duplicated-but-decoupled is the safer choice for a genuinely cross-runtime boundary.
//
// credentials: 'include' on every call: auth uses an httpOnly cookie, not a bearer
// header -- backend/src/app.ts's CORS config is an explicit origin allowlist (not a
// wildcard) specifically because the Fetch spec forbids that combination otherwise.
const BASE_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:3001";

export class BackendApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // No JSON body (or unparseable) -- keep the generic HTTP-status message.
    }
    throw new BackendApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- Auth -----------------------------------------------------------------------------

export interface SessionUser {
  userId: string;
  role: "USER" | "ADMIN";
}

export function login(email: string, password: string): Promise<{ id: string; email: string; role: "USER" | "ADMIN" }> {
  return request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function logout(): Promise<void> {
  return request("/auth/logout", { method: "POST" });
}

/** Always 200, even when logged out (user: null) -- see backend/src/auth/routes.ts's own
 *  comment on why: more convenient for an on-load session check than a 401 to special-case. */
export function getSession(): Promise<{ user: SessionUser | null }> {
  return request("/auth/me");
}

// --- Admin: model catalog ---------------------------------------------------------------

export interface ModelInfo {
  id: string;
  ownedBy?: string;
  raw: unknown;
}

export function getModelCatalog(): Promise<{ models: ModelInfo[]; fetchedAt: string }> {
  return request("/admin/models");
}

/** The only path (besides a cold process start) that makes a live NIM call -- never
 *  called automatically, only from an explicit admin button. */
export function refreshModelCatalog(): Promise<{ models: ModelInfo[]; fetchedAt: string }> {
  return request("/admin/models/refresh", { method: "POST" });
}

// --- Admin: health check -----------------------------------------------------------------

export type LlmRoleName = "EXPLAINER" | "VERIFIER";

export interface HealthProbeResult {
  reachable: boolean;
  supportsJsonSchema: boolean;
  latencyMs: number | null;
  spanishOk: boolean | null;
  sample: string | null;
  error: string | null;
}

export function runHealthCheck(modelId: string, role: LlmRoleName): Promise<HealthProbeResult> {
  return request("/admin/health-check", { method: "POST", body: JSON.stringify({ modelId, role }) });
}

// --- Admin: settings (model.explainer / model.verifier) ----------------------------------

export interface SettingResolution {
  value: string;
  source: "stored" | "default";
  updatedAt: string | null;
  updatedBy: string | null;
}

export function getSetting(key: string): Promise<SettingResolution> {
  return request(`/admin/settings/${encodeURIComponent(key)}`);
}

export function putSetting(key: string, value: string): Promise<SettingResolution> {
  return request(`/admin/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) });
}

export function resetSetting(key: string): Promise<void> {
  return request(`/admin/settings/${encodeURIComponent(key)}`, { method: "DELETE" });
}

// --- Admin: prompt versioning -------------------------------------------------------------

export interface PromptVersionRecord {
  id: string;
  key: string;
  body: string;
  version: number;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface PromptResolution {
  body: string;
  source: "stored" | "fallback";
  versionId: string | null;
  version: number | null;
}

export function listPromptKeys(): Promise<{ keys: string[] }> {
  return request("/admin/prompts");
}

export function getPromptVersions(key: string): Promise<{ versions: PromptVersionRecord[]; active: PromptResolution }> {
  return request(`/admin/prompts/${encodeURIComponent(key)}`);
}

export function createPromptVersion(key: string, body: string): Promise<PromptVersionRecord> {
  return request(`/admin/prompts/${encodeURIComponent(key)}`, { method: "POST", body: JSON.stringify({ body }) });
}

export function activatePromptVersion(id: string): Promise<PromptVersionRecord> {
  return request(`/admin/prompts/${encodeURIComponent(id)}/activate`, { method: "POST" });
}

export function deletePromptVersion(id: string): Promise<void> {
  return request(`/admin/prompts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// --- Admin: jobs + LLM calls (cost tracking) ----------------------------------------------

export interface JobSummary {
  id: string;
  batchId: string;
  status: string;
  findingRuleId: string;
  explanation: string | null;
  suggestedFix: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  claimedAt: string | null;
}

export interface JobEvent {
  id: string;
  jobId: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

export interface LlmCallRecord {
  id: string;
  jobId: string | null;
  role: LlmRoleName;
  purpose: "PRODUCTION" | "HEALTH_CHECK";
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  createdAt: string;
}

export interface JobDetail extends JobSummary {
  events: JobEvent[];
  llmCalls: LlmCallRecord[];
}

export interface ListPage {
  total: number;
  limit: number;
  offset: number;
}

export function listJobs(
  filter: { status?: string; batchId?: string; limit?: number; offset?: number } = {},
): Promise<{ jobs: JobSummary[] } & ListPage> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.batchId) params.set("batchId", filter.batchId);
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return request(`/admin/jobs${qs ? `?${qs}` : ""}`);
}

export function getJob(id: string): Promise<JobDetail> {
  return request(`/admin/jobs/${encodeURIComponent(id)}`);
}

export function listLlmCalls(
  filter: { role?: LlmRoleName; purpose?: "PRODUCTION" | "HEALTH_CHECK"; modelId?: string; limit?: number; offset?: number } = {},
): Promise<{ calls: LlmCallRecord[] } & ListPage> {
  const params = new URLSearchParams();
  if (filter.role) params.set("role", filter.role);
  if (filter.purpose) params.set("purpose", filter.purpose);
  if (filter.modelId) params.set("modelId", filter.modelId);
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return request(`/admin/llm-calls${qs ? `?${qs}` : ""}`);
}

export interface LlmCallTotals {
  modelId: string;
  role: string;
  purpose: string;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
}

export function getLlmCallTotals(): Promise<{ totals: LlmCallTotals[] }> {
  return request("/admin/llm-calls/totals");
}
