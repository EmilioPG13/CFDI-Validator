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
  times a month. Known gap, not yet resolved; see `corpus/README.md`. Don't present it as
  live without fixing this first.
- Ground-truth source data (XSDs, catalogs, Anexo 20, 69-B list) lives in `corpus/`, is
  fetched from public mirrors/SAT directly, and is documented with fetch dates in
  `corpus/README.md` — treat that file as the changelog for this data, keep it updated on
  every re-fetch.

## Dev-time subagents

Defined in `.claude/agents/`: `cfdi-domain` (owns the rule catalog), `fixture-gen` (synthetic
CFDI XMLs since there are zero real ones), `rule-engine` (implements rules against the
`Finding[]` contract), `hallucination-auditor` (audits LLM prompts/outputs for uncited
claims). All pinned to Sonnet — the orchestrating session runs Opus. Report views reuse the
global `ui-builder` agent rather than a project-local duplicate.
