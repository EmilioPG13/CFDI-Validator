import {
  ConsultaCfdiClient,
  type ConsultaCfdiParams,
  type ConsultaCfdiResult,
} from "../../sat-client/src/consultaCfdi.ts";

/**
 * Stateless proxy for SAT's `ConsultaCFDIService` — the ONE piece of Phase 4 that can't
 * run as static, browser-only WASM (see CLAUDE.md/the project plan): the SAT endpoint
 * sends no `Access-Control-Allow-Origin` header at all (confirmed live, 2026-08-06, via a
 * real OPTIONS preflight + POST against `consultaqr.facturaelectronica.sat.gob.mx` with a
 * cross-origin `Origin` header — not assumed), so a browser calling it directly is blocked
 * by CORS unconditionally. This function runs server-to-server (Vercel/Netlify function,
 * not a browser tab), where CORS — a browser-only enforcement mechanism — doesn't apply at
 * all, and re-exposes the result to the frontend from the SAME origin the static site is
 * served from (so the browser→proxy leg needs no CORS handling either, in the normal
 * same-deployment case — permissive `Access-Control-Allow-Origin: *` is still set on the
 * response below anyway, to keep local dev / a split-origin deployment working too; this
 * endpoint only ever returns already-public SAT data with no auth/cookies involved, so a
 * permissive origin costs nothing).
 *
 * Written against the Web-standard `Request`/`Response` (not a framework-specific
 * `(req, res)` signature) so it works as a Vercel Edge Function (`export const config`
 * below) with minimal changes if ever moved to Netlify's newer Web-standard Functions API
 * instead — matching the "keep it easy to move later" preference from this session's
 * hosting decision.
 *
 * Rate limiting: reuses `sat-client`'s own `ConsultaCfdiClient` (rate limiter + backoff,
 * already implemented and tested — not reimplemented here), instantiated once at MODULE
 * scope so sequential requests within the same warm function instance share one
 * rate-limiter clock. Known, deliberate limitation: this is best-effort, not a globally
 * shared limiter across concurrent/horizontally-scaled instances (would need a shared
 * store like Redis) — acceptable for a portfolio demo's expected traffic, revisit if this
 * ever needs to survive real concurrent load.
 */
export const config = { runtime: "edge" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Pure, exported separately from the request handler so it's unit-testable without
 *  constructing a Request object for every case. Never throws — returns null for any
 *  malformed shape, letting the caller decide the HTTP response. */
export function parseConsultaCfdiParams(body: unknown): ConsultaCfdiParams | null {
  if (typeof body !== "object" || body === null) return null;
  const { rfcEmisor, rfcReceptor, total, uuid } = body as Record<string, unknown>;
  if (![rfcEmisor, rfcReceptor, total, uuid].every(isNonEmptyString)) return null;
  return { rfcEmisor, rfcReceptor, total, uuid } as ConsultaCfdiParams;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

/**
 * The actual request-handling logic, exported separately from the default export so
 * tests can inject a fake `consultaFn` instead of hitting the real SAT endpoint —
 * `ConsultaCfdiClient` itself is already thoroughly tested in sat-client/test/; this
 * function only has NEW logic to verify (method/body validation, response shaping).
 */
export async function handleConsultaSatRequest(
  request: Request,
  consultaFn: (params: ConsultaCfdiParams) => Promise<ConsultaCfdiResult>,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    // CORS preflight for a split-origin deployment (see header comment) — no auth
    // headers requested, so a static allow-all is sufficient.
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed — use POST" }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const params = parseConsultaCfdiParams(body);
  if (!params) {
    return jsonResponse(
      { error: "Request body must include non-empty rfcEmisor, rfcReceptor, total, and uuid" },
      400,
    );
  }

  try {
    const result = await consultaFn(params);
    return jsonResponse(result, 200);
  } catch (err) {
    // A ConsultaCfdiClient failure here means the SAT endpoint itself is unreachable/
    // erroring after its own internal retries — surfaced as a gateway error, not a
    // client-input error (400) or a silent 200 with fabricated data.
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
}

const client = new ConsultaCfdiClient();

export default function handler(request: Request): Promise<Response> {
  return handleConsultaSatRequest(request, (params) => client.consulta(params));
}
