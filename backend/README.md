# `backend/` — Phase 5 LLM layer + admin console

A normal long-running Express service (Render free tier), deployed independently of the
Vercel-hosted `frontend/` — see `CLAUDE.md`'s Phase 5 note for why this is a separate
service rather than more Vercel functions. It owns exactly two things the static
WASM-in-the-browser `engine/`/`frontend/` pair cannot: the Explainer → Verifier LLM pipeline
behind `/auditoria`'s "Explicar con IA" button, and the admin console that manages it
(model catalog, prompt versions, job queue, LLM call log).

No compiled `dist/` output — like every other package in this repo, it runs `.ts` directly
via `node --experimental-strip-types` in both dev and production (`tsconfig.json` has
`"noEmit": true` on purpose). `npm run build` is a typecheck gate (`tsc -b`), not a real
compile step.

## Local setup

1. `npm install` (runs `prisma generate` via `postinstall`).
2. Copy `.env.example` to `.env` and fill in every var — `env.ts` fails fast at boot if any
   is missing, deliberately (see `.env.example`'s own header comment for why).
   - `DATABASE_URL` / `DATABASE_URL_TEST`: two separate Postgres databases. Free tier:
     [Neon](https://neon.tech) — create a project, then a branch per purpose (this repo's
     own setup uses three: `production` for Render, `development` for local `DATABASE_URL`,
     `jobqueue-test` for `DATABASE_URL_TEST` — see `CLAUDE.md`'s "Neon branch topology"
     gotcha for the full picture and why local dev and production must NOT share a branch).
   - `NVIDIA_API_KEY`: get one at [build.nvidia.com](https://build.nvidia.com) (NIM). Free
     tier is rate-limited (~40 req/min across all models) — already paced in
     `src/llm/rateLimiter.ts`, not something you need to handle yourself.
   - `JWT_SECRET` / `INTERNAL_DRAIN_TOKEN`: any long random string works for local dev
     (the `.env.example` comment has a one-liner to generate one). Production uses its own
     freshly-generated values on Render — never reuse a local dev secret in production.
3. `npx prisma migrate deploy` (applies the committed migrations against whichever DB
   `DATABASE_URL` points at).
4. `npm run prisma:seed` (creates the bootstrap `ADMIN` user from `SEED_ADMIN_EMAIL` /
   `SEED_ADMIN_PASSWORD` — the only path that can ever create an `ADMIN`; no public API
   route does this).
5. `npm run dev` (watches `src/server.ts`, default port from `env.ts`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `node --experimental-strip-types --watch src/server.ts` |
| `npm start` | Same, minus `--watch` — what Render actually runs in production |
| `npm run build` / `npm run typecheck` | `tsc -b` — a pure typecheck gate, no emitted output |
| `npm test` | `node --experimental-strip-types --test test/**/*.test.ts` — **must run with `backend/` as cwd** (`dotenv/config` loads `.env` relative to cwd) |
| `npm run prisma:migrate:dev` / `:deploy` | Create/apply a migration |
| `npm run prisma:seed` | Seed the bootstrap admin user |

## Layout

```
src/
  auth/       JWT + bcryptjs auth, requireAuth/requireAdmin/requireInternalToken middleware
  jobs/       Job queue (atomic claim via FOR UPDATE SKIP LOCKED), drain, processor
  llm/        Provider abstraction (NVIDIA NIM), rate limiting, model catalog, health checks,
              boot-time default-model staleness self-check
  prompts/    Explainer/Verifier prompt templates, PromptVersion CRUD, structural safety checks
  routes/     Express routers: /auth, /api/explain, /internal/drain-queue, /admin/*
  settings/   AppSetting resolver (DB override with an enforced code-level default fallback)
```

`test/` mirrors `src/` by concern, not by file — most tests use a fake-repo dependency
injection pattern (see `settingsResolver.test.ts` / `promptStore.test.ts` for the precedent)
so they need no live DB. The exceptions (`jobQueue.test.ts`'s concurrent-claim test) run
against the real `DATABASE_URL_TEST` branch and are informationally skipped, not failed,
when that var isn't set.

## Where the real documentation lives

This file is "how do I run it." For **why** things are built the way they are — the
Explainer/Verifier two-layer verification design, the health-check-as-enforced-gate
pattern, the six real production incidents from the first Render deploy, the Neon branch
topology, and every other gotcha specific to this backend — see the project root's
`CLAUDE.md` and the Phase 5 plan it links to. Session-to-session state (what's currently
deployed, what's open, test status as of the last session) lives in `docs/HANDOFF.md`
(gitignored, not part of this repo's tracked history).
