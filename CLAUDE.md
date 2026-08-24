# CFDI Risk Auditor

Bulk fiscal-risk auditor for Mexican accountants (contadores): drop in a ZIP of CFDI 4.0
XMLs already downloaded from the SAT portal, get back a risk report. Not a validator — every
PAC and the SAT itself already give that away free. The differentiator is two cross-checks
against **public, credential-free** SAT data: invoices cancelled by the supplier after the
client already deducted them, and suppliers on the 69-B (EFOS) list. **v1 never requests an
e.firma, a CSD, or any SAT credential** — that's a deliberate legal and positioning choice,
not a missing feature. See the plan for the full reasoning.

Full architecture, phased build order, and open decisions:
`C:\Users\Emili\.claude\plans\venga-claude-vamos-a-sleepy-fountain.md`

## Core principle

**The deterministic engine is the product. An LLM is never a source of truth.** Every
user-visible finding traces to a `ruleId` and a SAT citation (Anexo 20 section, catalog
table, or official rule code like `CFDI40147`). There is deliberately no LLM orchestrator —
the pipeline is fixed code, agents claim rows from a `status`-column queue, same pattern as
`../job-search-agents`.

## Gotchas

- `node --experimental-strip-types` (how every package here runs its tests directly off
  `.ts`, no build step) only **strips type annotations** — it does not transform syntax that
  generates real code. TS constructor parameter properties
  (`constructor(private readonly x: number) {}`), `enum`, and `namespace` all fail with
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Use a plain constructor parameter + explicit
  `this.x = x` instead of parameter properties; avoid `enum`/`namespace` entirely.
- `node` here is a **native Windows binary** — it does not resolve git-bash's `/c/...` POSIX
  paths. Use `C:/Users/...` or `C:\Users\...` in anything Node opens (confirmed with
  `node:sqlite`'s `DatabaseSync`, which failed silently-ish with "unable to open database
  file" on a POSIX path and worked immediately with a Windows one).
- `omawww.sat.gob.mx` refuses HTTPS connections from this environment (SNI/cert issue on
  their end) but serves plain HTTP fine. Don't burn time debugging TLS to that host.
- The SAT's CFDI XSD tree only resolves offline if the mirrored folder structure matches the
  `schemaLocation` relative paths exactly — see `corpus/README.md` for the exact layout.
  Flattening it breaks `xsd:import` resolution.
- **`libxml2-wasm` cannot see the real filesystem by default** — it's WASM, so
  `XmlDocument.fromBuffer(buf, { url })` only gives it a *base URL to resolve relative paths
  against*, not actual disk access. `xsd:import`/`xsd:include` fail with a "no such file"
  error that looks like a bad path even when the path is correct and the file exists. Fix:
  call `xmlRegisterFsInputProviders()` from `libxml2-wasm/lib/nodejs.mjs` once, before
  compiling any schema — see `engine/src/xsd.ts`. Not in the main `libxml2-wasm` export, and
  the package has no `exports` map restricting subpath imports, so the `lib/nodejs.mjs` path
  import just works.
- **The fix above is Node-only — the browser path (`engine/src/xsdBrowser.ts`, Phase 4b)
  uses a different, environment-agnostic mechanism**: `libxml2-wasm`'s *main* entrypoint
  (not the `nodejs.mjs` subpath) exports a generic `xmlRegisterInputProvider()` plus a
  ready-made `XmlBufferInputProvider` (in `libxml2-wasm/lib/utils.mjs`) that serves
  `xsd:import`/`xsd:include` from an in-memory `Record<string, Uint8Array>` — no real
  disk/network access needed at all. The gotcha: `XmlBufferInputProvider.match()` does an
  **exact string lookup**, and libxml2's own C-level URI-resolution runs *before* the
  provider is consulted, so a relative `schemaLocation` gets resolved via standard
  relative-URL rules against whatever base `url` the importing doc was loaded with —
  meaning the buffer map's keys must be pre-computed to match exactly what that resolution
  will produce. Confirmed working (a synthetic `file:///cfd/...` base, mirroring
  `corpus/xsd/`'s own relative layout, resolves correctly) via a real spike before writing
  `xsdBrowser.ts` — not assumed from the type defs alone. **Verified in a real Vite build,
  Phase 4e**: `npm run build` in `frontend/` (which imports `engine/src/pipeline.ts`,
  pulling in `xsdBrowser.ts`, all 13 rules, and `libxml2-wasm` from `engine/node_modules/`
  transitively via plain relative paths, no npm workspace) succeeds — 112 modules
  transformed, one ~1.5 MB/598 KB-gzip JS bundle (the WASM binary bundles inline, no
  separate `.wasm` asset in `dist/`). Confirms both the buffer-provider mechanism above
  AND the cross-package relative-import pattern work in a real bundler, not just Node.
- `cfdv40.xsd` alone can never validate a real CFDI: its `Complemento` node is an `xs:any`
  wildcard, and the XSD spec's default `processContents="strict"` means the validator must
  already have the complement's own schema loaded to accept it at all. `cfdv40.xsd` doesn't
  import complement schemas (TimbreFiscalDigital, Pagos, etc. are pluggable by design), but
  every real CFDI from the SAT portal *carries* a TimbreFiscalDigital complement — so this
  isn't an edge case, it's every real input. Use `loadCfdiValidatorWithComplements()` in
  `engine/src/xsd.ts`, not the bare `loadCfdi40Validator()`, for anything that touches real
  documents.
- `catCFDI.xsd` is 5.8 MB. That's correct, not a bad download — the SAT embeds every catalog
  value (all ~52k `ClaveProdServ` codes, etc.) as `xsd:enumeration` facets directly in the
  schema.
- The `phpcfdi/resources-sat-catalogs` SQLite DB (`corpus/catalogs/catalogs.db`) already
  encodes business rules as data, not just lookup values — e.g.
  `cfdi_40_usos_cfdi.regimenes_fiscales_receptores` **is** the RegimenFiscal×UsoCFDI
  compatibility rule. Check whether a rule is already a catalog query before treating it as
  something to derive from the Anexo 20 PDF by hand.
- The 69-B list (`corpus/efos/listado_completo_69b.csv`) fetched 2026-08-04 self-reports as
  current to **2025-12-31** — over seven months stale against a list the SAT updates several
  times a month, and the CSV itself hasn't been re-fetched since. **Mitigated 2026-08-05**
  by `emisor-efos-69b-sat`, which cross-checks live per invoice via `ConsultaCFDIService`
  (same round-trip `cfdi-cancelado-sat` already makes) — but that only covers the
  "Definitivo" tier; Presunto/Desvirtuado/Sentencia Favorable still only exist in this
  stale CSV. Don't present the CSV alone as live; see `corpus/README.md` for the full
  picture and what's still open.
- Ground-truth source data (XSDs, catalogs, Anexo 20, 69-B list) lives in `corpus/`, is
  fetched from public mirrors/SAT directly, and is documented with fetch dates in
  `corpus/README.md` — treat that file as the changelog for this data, keep it updated on
  every re-fetch.
- **Rules are typed against `CatalogSource` (`engine/src/catalogTypes.ts`), never the
  concrete `SatCatalogs`** — `SatCatalogs` (node:sqlite-backed, CLI/tests) and `BrowserCatalogs`
  (`engine/src/catalogsBrowser.ts`, JSON-bundle-backed, Phase 4) both implement it, and no
  rule has ever needed anything but `.findVigente()`. **`engine/catalog-bundle/*.json`
  (gitignored, regenerated on `npm install` via `engine/scripts/build-catalog-bundle.mjs`)
  is a precomputed, hand-trimmed subset of catalogs.db — not a WASM SQL engine.** Decided
  2026-08-06 after measuring the real access pattern: every rule's only query shape is a
  point lookup by id with a vigencia date-range filter against 5 known tables, never an
  arbitrary SQL query — a `Map` answers that, a shipped SQL parser/planner is the wrong
  tool. Trimmed to only the columns rules actually read: ~9.5 MB raw / ~0.4 MB gzip for all
  5 tables (vs. ~49 MB for the same tables untrimmed). `engine/test/catalogsBrowser.test.ts`
  proves both backends produce byte-identical `Finding[]` for every rule × fixture — treat
  a failure there as the bundle (or the trimmed-column list) having drifted from what a rule
  actually needs, not as a flaky test.
- **TypeScript must fully parse+check an ENTIRE source file to resolve even a single
  `import type` from it — there's no partial-file loading.** Hit in Phase 4e: `catalogs.ts`
  imports `node:sqlite` at its own top level; every rule file did `import type {
  CatalogSource } from "../catalogs.ts"`, which worked fine under `engine/`'s own
  Node-context tsconfig (has `node` types) but broke the instant `frontend/`'s
  browser-context typecheck (deliberately no `node` types — see `tsconfig.api.json`'s own
  comment on why) tried to type-check `engine/src/pipeline.ts`, which imports the full
  `rules` array, which transitively touches every rule file's `import type` of
  `CatalogSource` from `catalogs.ts` — Node's own `Cannot find module 'node:sqlite'`
  surfaced even though nothing actually *calls* `DatabaseSync` in that whole chain. Fix:
  `CatalogRow`/`CatalogSource` now live in `engine/src/catalogTypes.ts` (zero imports of
  any kind); `catalogs.ts` re-exports them for anyone still importing from there, but every
  file the browser pipeline touches (all rules, `rules/index.ts`, `pipeline.ts`,
  `catalogsBrowser.ts`) imports directly from `catalogTypes.ts` instead. Same reasoning
  extends to `parse.ts`: `parseCfdi` was typed `(xml: string | Buffer)` — `Buffer` is a
  Node global type, so merely importing `parseCfdi`'s signature (regardless of which
  branch is actually called) required it to be resolvable. Widened to `string |
  Uint8Array` (`Buffer` already satisfies `Uint8Array`, so this is backward-compatible),
  using `TextDecoder` instead of `Buffer#toString` internally. **Lesson for any future
  type shared between the Node-only and browser-safe sides of this codebase: put it in its
  own zero-import file, don't assume `import type` is free just because nothing at runtime
  touches the Node-only branch.**
- **Vercel deployment config (`frontend/vercel.json`), Phase 4g.** Root Directory on Vercel
  is `frontend`, but the build needs its siblings (`engine/`, `sat-client/`, and `corpus/`
  via `engine/`'s postinstall) — requires the dashboard's "Include source files outside of
  the Root Directory in the Build" toggle (API field `sourceFilesOutsideRootDirectory`;
  not settable from `vercel.json` itself, confirmed via Vercel's own REST API schema docs —
  this is a one-time manual step when the project is created). `installCommand` in
  `vercel.json` chains `npm install --include=dev --prefix ../engine` (runs `engine`'s
  postinstall: decompresses `corpus/catalogs/catalogs.db.bz2` and rebuilds
  `catalog-bundle/`) → same for `../sat-client` → then `frontend` itself. `--include=dev`
  is explicit on all three, not assumed default, because `unbzip2-stream` (needed by
  `engine`'s postinstall) and the whole TS toolchain are devDependencies, and it's
  undocumented whether Vercel's install step sets `NODE_ENV=production` (which would
  otherwise silently skip them). `engines.node: "24.x"` pinned in `frontend/package.json`
  (Vercel reads it from the Root Directory's own `package.json`; this overrides whatever
  Node version Project Settings has selected) — needed because `build-catalog-bundle.mjs`
  uses `node:sqlite`'s `DatabaseSync` with no `--experimental-sqlite` flag anywhere in the
  scripts, and that's only confirmed working, right now, on the exact local version this
  was verified against: v24.14.0. **Noted, not chased further**: `npm install --prefix
  ../engine` prints an `EBADENGINE` warning because `@nodecfdi/cfdi-to-json` declares
  `node: '>=18 <=22 || ^16'` in its own `package.json` — harmless (npm treats EBADENGINE as
  advisory, exit code 0, and the full local test suite already passes on v24.14.0 today),
  but if a future Node upgrade ever breaks that package for real, this is the first place
  to look. SPA routing needs a catch-all rewrite (`vercel.json`'s `rewrites`) because
  `main.tsx` uses React Router's `BrowserRouter`, not a hash router — without it, a direct
  load or refresh of `/auditoria` 404s instead of serving `index.html`.

  **Everything above this paragraph was right on the first real deploy** — confirmed by
  that deploy actually reaching and completing the main `npm run build`
  (corpus/engine/sat-client all present, Node 24.x active, `tsc -b` and `vite build` both
  succeeded). It took **six** real deploys, not one, to get `/api/consulta-sat` itself
  fully working — local simulation could not have caught any of the five failure modes
  below, and the full incident is worth reading end to end because the lesson generalizes:

  1. **Edge runtime** (the original choice, matching `api-src/consulta-sat.ts`'s own header
     comment about CORS): fails at *deploy* time —
     `NOW_SANDBOX_WORKER_EDGE_FUNCTION_UNSUPPORTED_MODULES`, "referencing unsupported
     modules: .../consulta-sat.js: ../../sat-client/src/consultaCfdi.ts" — even with
     `sourceFilesOutsideRootDirectory` on and the file physically present at build time.
     Edge Functions are bundled by a stricter, Cloudflare-Workers-style bundler that won't
     inline a relative import living outside the function's own directory tree.
  2. **Node.js runtime** (tried next, same file, same import, only `config.runtime`
     changed): deploys *successfully*, then crashes on the very first real invocation —
     `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
     '/var/task/sat-client/src/consultaCfdi.ts'`. Vercel transpiles only the entrypoint
     `.ts` to `.js`; it never bundles a transitive `.ts` import outside the function's own
     directory either — a different failure mode, same root cause as #1: **neither of
     Vercel's zero-config API function builders does a real esbuild-style dependency walk
     for this monorepo shape.**
  3. **Fix for #1/#2**: pre-bundle it ourselves so neither builder has anything left to
     fail on. The hand-authored, tested source moved to `frontend/api-src/`
     (`tsconfig.api.json`'s `include` and the `test` script's glob both point there now);
     `frontend/api/` is now 100% generated — `scripts/bundle-api.mjs` runs `esbuild` with
     `bundle: true` over `api-src/*.ts` on `predev`/`prebuild`, before Vercel's own
     build/function-detection ever runs, producing a fully self-contained `api/*.js` with
     every local import inlined (`sat-client` has zero external dependencies, so there's
     nothing left to resolve). Verified by importing the bundled output directly in a
     plain Node process and invoking its default export with real `Request` objects — not
     just "it built without error." Runtime stayed `nodejs` (not reverted to `edge`) —
     no reason to go back once the actual blocker was gone.
  4. **This deploy (#3 overall) reached `state: "READY"`** (`lambdaRuntimeStats:
     {"nodejs":2}`) and looked done — `GET /` and `GET /auditoria` both returned 200. But
     hitting `/api/consulta-sat` for real (`OPTIONS`, then `POST`) told a different story:
     every response carried `Content-Disposition: inline; filename="index.html"`, a `GET`
     returned the actual landing-page HTML, and none of `handleConsultaSatRequest`'s own
     CORS headers were present. **The deployed function was never being reached at all** —
     the SPA catch-all rewrite's bare `"source": "/(.*)"` was swallowing `/api/consulta-sat`
     too, because this project has no framework preset (`"framework": null` in the project
     metadata means no zero-config adapter automatically prioritizes functions over
     rewrites the way Next.js's would). Fixed with the standard documented
     negative-lookahead pattern: `"source": "/((?!api/).*)"`.
  5. **Deploy #4** (the rewrite fix, `api/*.js` still gitignored per the Phase 4g fix-#3
     pattern used everywhere else in this repo) reached `state: "READY"` again — but this
     time `/api/consulta-sat` came back a clean `404 NOT_FOUND` from Vercel itself, not from
     our code or the SPA rewrite. The build log gave it away: every prior deploy showed a
     distinct "Installing dependencies... Using TypeScript..." step where Vercel processed
     `api/`'s function(s); this one didn't have that step at all. **Vercel decides which
     files under `api/` are functions by scanning the git checkout *before* running any
     install/build command** — `scripts/bundle-api.mjs` only produces `api/consulta-sat.js`
     *during* `prebuild`, so at the point Vercel's scan runs, the file doesn't exist yet and
     zero functions get planned for the deployment. This is NOT how `outputDirectory`
     (`dist/`) works for the static site — only `api/` function detection has this earlier,
     pre-build scan. Fixed by committing `frontend/api/*.js`(`.map`) directly instead of
     gitignoring them — the one generated artifact in this whole repo that must be
     committed, for a platform-timing reason rather than a content-curation one (contrast
     with `frontend/public/demo/muestra-cfdi.zip`, committed for curation, not timing).
     `bundle-api.mjs` stays wired into `predev`/`prebuild` so local dev/CI never runs
     against a stale bundle, but that no longer relieves the commit step — see
     `frontend/api/README.md`'s "Why committed, not gitignored" section for the discipline
     this now requires (regenerate and re-commit whenever `api-src/*.ts` or its `sat-client`
     dependency changes).
  6. **Deploy #5 finally had a real function registered** (`lambdaRuntimeStats:
     {"nodejs":1}`) — but every request to `/api/consulta-sat` just hung with no response,
     including a bare `OPTIONS` preflight that touches zero network code. `GET /` and
     `GET /auditoria` were both instant; only the function hung. Vercel's own runtime logs
     (`get_runtime_logs`, not the build logs) had the answer: `WARN: default export
     returned a 'Response'. The default-export signature is '(req, res) => void' — returns
     are ignored.` A bare `export default function handler(request: Request):
     Promise<Response>` — the shape used since Phase 4d, unchanged through all four prior
     fixes — is NOT the Web-standard shape Vercel's Node.js runtime accepts for a default
     export; it's interpreted as the legacy Node `(req, res) => void` callback style, so
     returning a `Response` is silently ignored and no response is ever sent. The
     documented Web-standard shape needs a default export that's an **object** with a
     `fetch` method (`export default { fetch(request) { return response } }`), or named
     `GET`/`POST`/etc. exports — not a bare function, even though a bare function
     type-checks fine against `Request => Promise<Response>` and works perfectly when
     invoked directly in a plain Node process (exactly how this was "verified" after fixes
     #3 and #4). Fixed in `api-src/consulta-sat.ts`.

  **The lesson that generalizes, four times over**: local simulation can prove an import
  resolves, a build compiles, and a function behaves correctly when invoked directly in a
  plain Node process — but it cannot prove how a specific cloud platform's zero-config
  function bundler treats a cross-package import, how its routing layer prioritizes a
  catch-all rewrite against a function, *when* in the pipeline it decides a function
  exists at all, or whether its runtime actually recognizes the export shape being handed
  to it. All four only get proven by an actual deploy AND an actual request against the
  live URL — direct invocation of the bundled module (issue #6's own "verification" after
  fixes #3/#4) proved the code's *logic* was correct while missing that Vercel's runtime
  never calls it that way at all. Checking that `state` reads `READY` (or that a status
  code looks plausible) is not enough — issue #4 returned CORS-preflight-shaped 204s and
  validation-error-shaped 405s by coincidence (Vercel's own automatic static-file OPTIONS
  handling), issue #5's build log looked identical in every way that matters except one
  missing section, and issue #6 produced no response at all (a hang, not an error) with
  nothing in the build log to explain it. Only inspecting the actual response
  headers/body, the full build log, or — the one that finally caught #6 — the *runtime*
  logs (`get_deployment_build_logs` / `get_runtime_logs` on the Vercel MCP) caught each of
  these in turn.

  **Deploy #6 is the first one actually confirmed fully working**, live, at
  `https://cfdi-validator.vercel.app` — not just `state: "READY"`, but a real `OPTIONS`
  preflight returning `handleConsultaSatRequest`'s own CORS headers, a bad `POST` returning
  its own exact validation-error JSON, and a well-formed `POST` returning a genuine SAT
  `ConsultaCFDIService` SOAP response end-to-end (`"N - 602: Comprobante no encontrado"` —
  correct, since the UUID used was a placeholder, not a real invoice against that RFC; the
  point proven is that the live round trip through the deployed proxy actually happened).

- **Neon branch topology, split 2026-08-10.** Through Phase 5e, local dev and the live
  Render deployment shared the same Neon branch (`production`) — a deliberate pre-launch
  simplification, called out as an open item to revisit before real user data existed. Now
  split: project `cfdi-validator` (Neon project id `fancy-heart-93244841`) has three
  branches — `production` (host `ep-polished-river-ayxxz36g...`, primary/default, what
  Render's dashboard-configured `DATABASE_URL` points at — not settable from `render.yaml`
  since it's `sync: false`, entered once in the dashboard), `development` (host
  `ep-late-bar-aycj9caq...`, branched from `production` 2026-08-10, what local
  `backend/.env`'s `DATABASE_URL` now points at), and `jobqueue-test` (host
  `ep-snowy-forest-ayhdgx7k...`, pre-existing, `DATABASE_URL_TEST`, used only by
  `jobQueue.test.ts`). Branching copies data at branch-creation time, not live — expect
  `development` to silently drift from `production` afterward (that's the point). Created
  via `npx neonctl branches create` (no install needed, resolved via `npx` directly) using
  a short-lived API key from Neon's Account Settings → API Keys, revoked after use — no
  Neon MCP or CLI is preconfigured in this environment.
- **`backend/`'s `npm start` was silently broken from the moment it was written, Phase 5e.**
  `backend/tsconfig.json` has `"noEmit": true` (this repo's project-wide "run `.ts` directly,
  no compile step" convention — same reasoning as the `--experimental-strip-types` gotcha
  above), but `package.json`'s original scripts were `"build": "tsc -b"` +
  `"start": "node dist/server.js"` — a compile-then-run pair that assumes emitted output
  `tsc -b` was configured to never produce. Nobody had ever actually run `npm run build &&
  npm start` end to end before the Render deploy prep caught it: `dist/` never gets created,
  so `npm start` fails with `Cannot find module`. Fixed: `"start"` now runs
  `node --experimental-strip-types src/server.ts` directly, the same way `"dev"` already
  did (minus `--watch`) — `"build"` stays `tsc -b`, repurposed as a pure typecheck gate
  (fail the deploy on a real type error) rather than an actual compile step, since this
  backend genuinely has none. Verified by actually running the fixed `npm start` locally,
  in both default and `NODE_ENV=production` mode, and hitting `/health` for real — not just
  reading the diff. **Lesson**: an npm script that looks conventional (`build`/`start`) can
  be dead code nobody's ever invoked, especially when `dev` uses a completely different
  path (`--watch` + direct `.ts` execution) that never exercises it — matches the Phase 4g
  deploy chronicle's own broader lesson that local *assumption* isn't local *verification*.
- **Phase 6 Catalog Watcher (`watcher/`, built 2026-08-23).** Self-contained zero-dep
  package (only `unbzip2-stream`, same as engine) that runs monthly in GitHub Actions
  (`.github/workflows/catalog-watcher.yml`, cron + manual dispatch, free tier) and locally
  via `npm run watch -- --local`. Flow: compare upstream (phpcfdi releases, XSD tree on
  master, Anexo 20 PDF, 69-B CSV) against the machine-readable pin `corpus/sources.json`
  → deterministic diff → optional NIM narration under a strict grounding check → PR.
  **Never merges**; PR body carries a human checklist. Replay tests against real
  historical releases are network-heavy and gated: `RUN_WATCHER_REPLAY=1 node --test` from
  `watcher/`. The narration grounding check is TEXTUAL, not arithmetic: a true-but-derived
  number ("24 tablas sin cambios") gets rejected unless precomputed into the payload —
  which is why `buildNarrationFacts` ships every count as a field (caught live, twice, on
  the first real run).
- **`Readable.from(plainUint8Array)` iterates it BYTE-BY-BYTE**, and through a transform
  like `unbzip2-stream` the result is silently EMPTY output with no error — a `Buffer`
  emits as one chunk and decodes fine. If a pipeline yields nothing, check what class the
  source actually is before suspecting the transformer (caught by watcher's own round-trip
  test on its first run).
- **NIM models reach end of life silently and code-level defaults rot with them**:
  `z-ai/glm-5.2` went 410 Gone on 2026-08-21 (second incident of this exact class after
  Phase 5e's mistral default). Two defenses now exist: `backend/src/server.ts` runs
  `llm/defaultModelSelfCheck.ts` on every boot (logs a loud warning naming the stale role
  and its remediation), and the watcher degrades to diff-only when its narration model is
  gone. Neither auto-fixes — model swaps are a human decision.

## Dev-time subagents

Defined in `.claude/agents/`: `cfdi-domain` (owns the rule catalog), `fixture-gen` (synthetic
CFDI XMLs since there are zero real ones), `rule-engine` (implements rules against the
`Finding[]` contract), `hallucination-auditor` (audits LLM prompts/outputs for uncited
claims). All pinned to Sonnet — the orchestrating session runs Opus. Report views reuse the
global `ui-builder` agent rather than a project-local duplicate.
