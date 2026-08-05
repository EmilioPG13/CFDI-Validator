# CFDI Risk Auditor

A bulk fiscal-risk auditor for Mexican accountants (*contadores*). Drop in a ZIP of CFDI 4.0
invoices already downloaded from the SAT portal — get back a risk report. **No e.firma, no
SAT credentials, no CSD, ever.**

> 🚧 **Early build.** The deterministic rule engine works end to end for a first pair of
> rules; the web app, LLM explanation layer, and the SAT cross-checks (cancellation status,
> 69-B/EFOS suppliers) are not wired up yet. See [Status](#status) below for the real state,
> and the [full build plan](#roadmap) for what's next.

## Why this exists

Every PAC (SAT-authorized invoicing provider) and the SAT itself already give away CFDI 4.0
*validation* for free. That's not a business. What accountants actually lose sleep over at
month-end close is different: did a supplier cancel an invoice **after** the client already
deducted it? Is a supplier quietly sitting on the SAT's [69-B/EFOS
list](https://www.sat.gob.mx/) — meaning every invoice they issued may produce zero tax
effect, retroactively? Nobody surfaces that. This project does, using only **public,
credential-free** SAT data:

- `ConsultaCFDIService` — the SAT's public SOAP endpoint — returns an invoice's live
  cancellation status and 69-B validation, given nothing but its UUID and the two RFCs
  already on the invoice.
- The SAT's own 69-B list, a public CSV updated several times a month.

No e.firma required for either. That's a deliberate legal and product decision, not a
missing feature — the e.firma has the same legal weight as a handwritten signature in Mexico
(Art. 17-D CFF), and asking for it would put this tool in the same trust bracket as software
that already requires it for descarga masiva. Not asking is the harder, more defensible
position to build toward, and it's the one this project takes.

## Core principle

**The deterministic engine is the product. An LLM is never a source of truth.** Every
user-visible finding traces back to a `ruleId` and a real SAT citation — an Anexo 20 section,
a specific catalog table, or an official rejection code like `CFDI40147`. There is
deliberately no LLM orchestrator deciding what to check; the pipeline is fixed code. The only
place a model appears is explaining an already-deterministic finding in plain Spanish, and
even that explanation is checked against the same citation before it ships.

## Architecture

```
ZIP of CFDI XMLs
  → parse (XML → structured record)
  → validate against the real CFDI 4.0 XSD tree (offline, no network)
  → resolve against SAT catalogs (RegimenFiscal, UsoCFDI, ClaveProdServ, códigos postales…)
  → evaluate rules  →  Finding[] { ruleId, fieldPath, severity, satReference, evidence }
  → [cancellation check via ConsultaCFDIService]   ← not yet built
  → [69-B supplier match]                          ← not yet built
  → [LLM explains each Finding, in Spanish, cited]  ← not yet built
  → risk report
```

Runs local-first: parsing, XSD validation, catalog resolution and rule evaluation are pure
functions with no network calls, designed to run in-browser via WASM once the web app lands
(see [Roadmap](#roadmap)) — so client XML never has to leave the accountant's machine to be
checked. Only the SAT cross-checks *require* leaving the browser, and they need nothing but a
UUID and two RFCs the invoice already carries.

## The subagent system

This project is built with a deliberately narrow multi-agent setup — not because more agents
is more impressive, but because it's the same pattern that makes the *product's* legal
grounding possible, applied to how the codebase itself gets written. Four dev-time agents,
each with a single accountable job:

| Agent | Job | Why it's a separate agent |
|---|---|---|
| [`cfdi-domain`](.claude/agents/cfdi-domain.md) | Turns SAT source material (Anexo 20, catalog data, official rejection codes) into a cited rule spec | Owns the one thing that must never be guessed: the citation |
| [`fixture-gen`](.claude/agents/fixture-gen.md) | Generates synthetic, structurally-valid CFDI XML — one pair (pass/fail) per rule | There are zero real customer invoices to test against |
| [`rule-engine`](.claude/agents/rule-engine.md) | Implements a rule spec as a pure TypeScript function, verified against its fixtures | Consumes the spec; never invents one |
| [`hallucination-auditor`](.claude/agents/hallucination-auditor.md) | Audits LLM-facing prompts and outputs for any claim not traceable to a `ruleId` | The project's legal liability shield, checked at dev time |

Each agent hands its output to the next — `cfdi-domain`'s spec is what `fixture-gen` builds
fixtures for and what `rule-engine` implements against — and every rule that ships has a
citation, a passing fixture, and a failing fixture, or it doesn't ship. Full reasoning for
this split, and why it mirrors a pattern already proven out in a sibling project, lives in
[`CLAUDE.md`](CLAUDE.md).

## Status

**Working today:**
- The full XSD validation pipeline against the real, offline CFDI 4.0 schema tree —
  including the TimbreFiscalDigital stamp complement every real invoice carries (a
  non-obvious fix; see `CLAUDE.md`'s gotchas if curious why the base schema alone can't do
  this).
- Two rules, end to end, each with a cited spec, a passing and a failing fixture, and a
  passing test: `RegimenFiscal`×`UsoCFDI` compatibility, and postal-code existence in
  `DomicilioFiscalReceptor` (the latter deliberately scoped down from — and documented as
  *not* equivalent to — the SAT's real `CFDI40147`/`CFDI40148` checks, which require data
  this project will never have access to; see `engine/rules/registry.json`).
- A Kimi-generated landing page scaffold in `frontend/`, not yet wired to anything live.

**Not built yet:** the SAT cross-checks that are the actual differentiator (cancellation
status, 69-B matching), the browser/WASM port of the engine, the LLM explanation layer, and
any UI beyond the static landing page. See [Roadmap](#roadmap).

## Getting started

Requires Node 22–24 and npm.

```bash
git clone <this-repo>
cd cfdi-risk-auditor

# Deterministic engine — parsing, XSD validation, rule evaluation
cd engine
npm install   # also decompresses corpus/catalogs/catalogs.db from the tracked .bz2
npm test      # 8 passing tests: XSD resolution, fixture validity, both rules
npm run typecheck

# Landing page (static, not yet wired to the engine)
cd ../frontend
npm install
npm run dev
```

The ground-truth data the engine validates against — the CFDI 4.0 XSD tree, SAT catalogs,
Anexo 20, and the 69-B list — lives in [`corpus/`](corpus/README.md), fetched from public SAT
mirrors and documented with fetch dates. That file also carries an open, unresolved caveat
worth reading before trusting any 69-B-derived claim: the fetched list self-reports as
current to 2025-12-31, months stale against a list the SAT updates several times monthly.

## Legal & privacy posture

- No credentials of any kind are requested or stored — not now, not planned for a first
  release. If e.firma-based bulk download is ever added, it would require local-only signing
  (the key never reaching a server), an open-sourced signing module, and legal review first —
  not a casual feature addition.
- Every finding cites a real, checkable source. Nothing is presented as a fact without one.
- This is not tax advice, and the product will say so explicitly wherever findings are shown.

## Roadmap

Full phased plan (ground-truth corpus → deterministic core → SAT cross-checks → rule depth →
web app → LLM layer → automated catalog updates) is tracked outside this repo during active
design; `CLAUDE.md` points to it. Broad strokes, in order: more rules with real citations,
the `ConsultaCFDIService` cancellation check and 69-B matcher (the actual product
differentiator), porting the engine to run in-browser via WASM, then — and only then — an LLM
layer for plain-Spanish explanations, gated behind the same citation discipline the rule
engine already enforces.

## License

MIT — see [LICENSE](LICENSE).
