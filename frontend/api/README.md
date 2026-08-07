# `api/` — the one non-static piece of this deployment

`consulta-sat.ts` is a Vercel Edge Function (`export const config = { runtime: "edge" }`)
proxying SAT's `ConsultaCFDIService` for the two live SAT-sourced rules
(`cfdi-cancelado-sat`, `emisor-efos-69b-sat`). It exists only because that SAT endpoint
sends no `Access-Control-Allow-Origin` header — confirmed live, 2026-08-06 — so a browser
can never call it directly; everything else in this project runs as static WASM in the
browser with no backend at all. See `CLAUDE.md` and the project plan for the full
architecture reasoning.

## Deployment note — monorepo import

This file imports `sat-client`'s `ConsultaCfdiClient` via a plain relative path
(`../../sat-client/src/consultaCfdi.ts`), the same pattern `engine/src/rules/index.ts`
already uses successfully. `sat-client` has zero external dependencies (`package.json`:
`"dependencies": {}`), so there's nothing to install for this specific import to resolve —
but Vercel's project settings must be configured with **"Include source files outside of
the Root Directory in the Build"** enabled (Vercel's own documented setting for exactly
this monorepo shape — `frontend/` as the deployed Root Directory, importing a sibling
package that lives outside it; the underlying API field is `sourceFilesOutsideRootDirectory`
— confirmed against Vercel's own REST API schema docs, Phase 4g). Edge Functions are
bundled (esbuild-style) at build time, not run as raw source, so as long as that toggle is
on and the sibling file is present on disk during the build, the relative import should
resolve into the function bundle the same way a Node bundler would. See `frontend/vercel.json`
for the full monorepo build config (install chain across `engine`/`sat-client`/`frontend`,
Node version pin) and `CLAUDE.md`'s "Vercel deployment config" gotcha for the full
reasoning. **Still NOT verified against a real Vercel deployment as of Phase 4g** — the
config is now in place and locally simulated end-to-end, but Vercel's own build container
hasn't actually run it yet. If a deployment fails to resolve this import, that toggle is
still the first thing to check.

## Local testing

`api/consulta-sat.test.ts` unit-tests the HTTP-handling wrapper (method/body validation,
response shaping, CORS headers) using Node's global `Request`/`Response` and an injected
fake `consultaFn` — it never hits the real network. `ConsultaCfdiClient` itself (the actual
SOAP call, rate limiting, retries) is already covered by `sat-client/test/`, including live
calls against the real SAT endpoint — not re-tested here.

Run with `npm run test` from `frontend/` (same `node --experimental-strip-types --test`
convention as `engine/` and `sat-client/`).
