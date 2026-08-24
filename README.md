# CFDI Risk Auditor

A bulk fiscal-risk auditor for Mexican accountants (*contadores*). Drop in a ZIP of CFDI 4.0
invoices already downloaded from the SAT portal — get back a risk report. **No e.firma, no
SAT credentials, no CSD, ever.**

**Live:** [https://cfdi-validator.vercel.app](https://cfdi-validator.vercel.app) · public
demo runs on bundled sample invoices, no account needed · admin console at `/admin/login`.

All six planned phases are built, deployed, and verified end-to-end against production:
deterministic engine → live SAT cross-checks → web app (WASM, local-first) → LLM
explanation layer with an enforcing Verifier → admin console → automated catalog watcher.

## Why this exists

Every PAC (SAT-authorized invoicing provider) and the SAT itself already give away CFDI 4.0
*validation* for free. That's not a business. What accountants actually lose sleep over at
month-end close is different: did a supplier cancel an invoice **after** the client already
deducted it? Is a supplier sitting on the SAT's 69-B/EFOS list — meaning every invoice they
issued may produce zero tax effect, retroactively? Nobody surfaces that. This project does,
using only **public, credential-free** SAT data:

- `ConsultaCFDIService` — the SAT's public SOAP endpoint — returns an invoice's live
  cancellation status and EFOS validation, given nothing but its UUID and the two RFCs
  already on the invoice.
- The SAT's own 69-B list (a public CSV), refreshed monthly by this repo's Catalog Watcher.

No e.firma required for either. That's a deliberate legal and product decision, not a
missing feature — the e.firma has the same legal weight as a handwritten signature in Mexico
(Art. 17-D CFF). Not asking is the harder, more defensible position, and it's the one this
project takes.

## Core principle

**The deterministic engine is the product. An LLM is never a source of truth.** Every
user-visible finding traces to a `ruleId` and a real SAT citation — an Anexo 20 section, a
specific catalog table, or an official rejection code like `CFDI40147`. There is
deliberately no LLM orchestrator deciding what to check; the pipeline is fixed code. The
only place a model appears is explaining an already-deterministic finding in plain Spanish,
and even that explanation passes two enforcement layers before it ships:

1. **Verifier Layer 1 (deterministic):** every cited `ruleId` must exist in the rule
   registry, every citation-shaped token must ground in the Finding's own `satReference`
   (accent/case tolerant), every number in the prose must come from the Finding's evidence,
   and unstated consequences ("el SAT lo rechazaría") are rejected outright.
2. **Verifier Layer 2 (a second model, different family by enforced policy):** semantic
   overstatement check. Fail-closed on both layers.

## Architecture as built

```
Browser (WASM, local-first)                    Server (stateless)                 External
────────────────────────────                   ──────────────────                 ────────
ZIP → unzip → parse XML
  → XSD validate (libxml2-wasm, offline)
  → resolve SAT catalogs (bundled JSON)
  → evaluate 13 cited rules  →  Finding[]
       │  redact (RFCs/UUIDs never leave)
       └──────────────────────────────────► POST /api/explain → Job queue (Postgres)
                                              │ Explainer (NIM) → Verifier L1+L2
   poll ◄──────────────────────────────────── ┘
  → UUID batch ─────────────────────────────────────────────────────────────► ConsultaCFDIService
  → supplier RFCs vs 69-B CSV (in-browser index)

Monthly, unattended (GitHub Actions):
  Catalog Watcher: phpcfdi releases / XSD tree / Anexo 20 PDF / 69-B CSV
    vs corpus/sources.json pin → deterministic diff → grounded AI summary → pull request
    (never merges; human reviews every catalog-update PR)
```

The heavy lifting (parse, XSD, catalogs, rules) runs **in your browser via WASM** — client
XML never leaves the machine except the four fields `ConsultaCFDIService` requires, which is
disclosed in the UI. The LLM layer receives redacted `Finding` structures only.

## Repository map

| Package | What it is |
|---|---|
| [`engine/`](engine/) | The deterministic core: parsing, offline XSD validation, catalog resolution, 13 rules → `Finding[]`. Pure functions, portable to WASM |
| [`sat-client/`](sat-client/) | Zero-dependency clients for the SAT's public endpoints (`ConsultaCFDIService`, 69-B index) |
| [`frontend/`](frontend/) | React + Vite SPA: landing, drag-drop audit UI, report with per-finding "Explicar con IA", admin console. Vercel-hosted |
| [`backend/`](backend/) | Express API: auth, job queue (`FOR UPDATE SKIP LOCKED`), NIM provider abstraction, prompt versioning, admin routes. Render-hosted |
| [`watcher/`](watcher/) | Phase 6 Catalog Watcher: monthly GitHub Actions cron, deterministic diff of SAT ground-truth sources, grounded narration, auto-opened PRs |
| [`corpus/`](corpus/README.md) | Ground truth: CFDI 4.0 XSD tree, SAT catalogs (phpcfdi SQLite), Anexo 20 PDF, 69-B CSV — pinned in `corpus/sources.json`, fetched from public sources with documented dates |

## Getting started

Requires Node 24 and npm.

```bash
git clone https://github.com/EmilioPG13/CFDI-Validator.git
cd CFDI-Validator

# Deterministic engine (no network, no credentials)
cd engine && npm install && npm test && npm run typecheck

# Web app
cd ../frontend && npm install && npm run dev    # http://localhost:5173

# Backend (needs DATABASE_URL etc.; see backend/.env.example)
cd ../backend && npm install && npm run dev     # http://localhost:3001

# Catalog Watcher (local dry-run mode; CI opens PRs monthly on its own)
cd ../watcher && npm install && npm run watch -- --local
```

Test suites across all five packages run green; the watcher additionally carries replay
tests against real historical phpcfdi releases, gated behind `RUN_WATCHER_REPLAY=1`.

The ground-truth data lives in [`corpus/`](corpus/README.md), documented with fetch dates
and known caveats — notably the 69-B list's self-declared as-of date, which is why the
EFOS rule cross-checks live status per invoice instead of trusting the CSV alone.

## Legal & privacy posture

- No credentials of any kind are requested or stored.
- Client XML is parsed and validated in-browser; only redacted finding structures reach the
  server, and the SAT round-trip uses fields the invoice already carries.
- Every finding cites a real, checkable source; the Verifier rejects explanations that
  invent one.
- This is not tax advice, and the UI says so explicitly wherever findings are shown.

## License

MIT — see [LICENSE](LICENSE).
