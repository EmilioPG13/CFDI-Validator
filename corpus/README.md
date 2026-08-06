# Corpus — ground truth for the CFDI Risk Auditor

Everything the deterministic engine validates against. Nothing here is fetched at runtime —
Phase 1 loads it from disk/DB so the browser-side WASM engine never calls `sat.gob.mx`
directly for schema/catalog data. Re-run the fetch commands below periodically (the Catalog
Watcher in Phase 6 is meant to automate this) and update the dates in this file when you do.

## Contents

### `xsd/` — CFDI 4.0 + Timbrado Fiscal Digital schema tree

Mirrored from [`phpcfdi/resources-sat-xml`](https://github.com/phpcfdi/resources-sat-xml),
which republishes the SAT's own XSDs with relative paths intact so the import tree resolves
fully offline. Directory layout mirrors the `schemaLocation` paths on purpose — do not
flatten it, or `xsd:import` resolution breaks.

```
xsd/cfd/4/cfdv40.xsd                              ← root: the CFDI 4.0 comprobante schema
xsd/cfd/catalogos/catCFDI.xsd                      ← every catalog value as an xsd:enumeration (5.8 MB — this is correct, not bloat)
xsd/cfd/tipoDatos/tdCFDI/tdCFDI.xsd                ← shared primitive types (RFC, CURP, importe, etc.)
xsd/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd  ← PAC stamp complement; present on every real, timbrado'd CFDI
```

Import chain, verified by resolving each `schemaLocation` against what's actually on disk:
`cfdv40.xsd` → `catCFDI.xsd` + `tdCFDI.xsd` (both leaves, no further imports).
`TimbreFiscalDigitalv11.xsd` → `tdCFDI.xsd` only. Four files is the complete tree for base
CFDI + stamp validation — no other complements pulled in yet (Pagos, Comercio Exterior,
Nómina, etc. are separate complements, out of scope until a rule needs them).

Fetched: 2026-08-04, from `master` of `phpcfdi/resources-sat-xml` (unversioned mirror — it
tracks whatever SAT currently publishes, no release tags to pin to).

### `catalogs/catalogs.db` — SAT catalog values, structured

From [`phpcfdi/resources-sat-catalogs`](https://github.com/phpcfdi/resources-sat-catalogs)
release **`v10.13.20260731`** (published 2026-07-31 — five days before this fetch, so this is
current against the Jul 2026 SAT catalog update). SQLite, 179 tables, ~100 MB decompressed.
`.db.bz2` is kept alongside `.db` so re-fetching is a diff against a known-good compressed
artifact.

Confirmed via `node:sqlite` (`DatabaseSync`, read-only) — **Windows-style paths only**;
`node` on this machine is a native Windows binary and does not resolve git-bash's `/c/...`
POSIX paths.

Tables that matter most for the rule engine, spot-checked:

- `cfdi_40_regimenes_fiscales` (19 rows) — `aplica_fisica` / `aplica_moral` flags,
  `vigencia_desde` / `vigencia_hasta`.
- `cfdi_40_usos_cfdi` (24 rows) — **`regimenes_fiscales_receptores` is a literal
  comma-separated list of valid `RegimenFiscal` codes per `UsoCFDI`.** This is the
  Régimen×Uso compatibility rule (the one behind `CFDI40147`-class rejections) already
  encoded as data, not something to hand-derive from the Anexo 20 prose.
- `cfdi_40_productos_servicios` (52,513 rows) — `ClaveProdServ`, with `iva_trasladado`,
  `ieps_trasladado`, `complemento` (required complement, if any), validity window.
- `cfdi_40_reglas_tasa_cuota` (19 rows) — valid tax rate/quota combinations per tax type.

Every `cfdi_40_*` table carries `vigencia_desde`/`vigencia_hasta`, so date-scoped validity
(a code retired mid-year, a regime added for RESICO primario) is a query, not a special case.

There are also un-suffixed `cfdi_*` tables (no `_40_`) — haven't checked whether those are a
"latest across versions" view or a 3.3 holdover; confirm before relying on them.

### `anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf`

Official technical guide, fetched 2026-08-04 from
`omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf`
(1.5 MB). Source of the business rules that live in prose rather than in the catalog DB —
this is what the `cfdi-domain` subagent reads when a rule isn't just a table lookup.

### `efos/listado_completo_69b.csv`

Fetched 2026-08-04 from `omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv`
(4.5 MB, Windows-1252 encoded — re-encode to UTF-8 on load). Single file, not five: it
carries `Situación del contribuyente` as a column, so it already covers presunto /
desvirtuado / definitivo / sentencia favorable in one table — no need for the four separate
per-status lists the SAT also publishes.

**⚠️ Freshness gap, mitigated but not resolved:** the file's own header states
*"Información actualizada al 31 de diciembre de 2025."* Fetched 2026-08-04 — **over seven
months stale** against a list the SAT is documented to update several times a month, and
this file itself hasn't been re-fetched since. This is the exact risk the product is
supposed to catch, so a report relying on this CSV alone without flagging its as-of date
would be dishonest.

Mitigation shipped 2026-08-05: `emisor-efos-69b-sat` (`engine/rules/registry.json`,
`engine/src/rules/emisorEfos69bSat.ts`) cross-checks the Emisor RFC against SAT's own
`ConsultaCFDIService.ValidacionEFOS` field **live, per invoice, at query time** — same
network round-trip `cfdi-cancelado-sat` already makes, so zero extra cost. This closes
the staleness gap for the "Definitivo" tier specifically (the only tier `ValidacionEFOS`
can express), but does **not** replace this CSV: only the CSV carries Presunto /
Desvirtuado / Sentencia Favorable, and reconciling the two when they disagree (stale CSV
says clean but live says found, or vice versa) is still an open product decision — see
`emisor-efos-69b-sat`'s own `notes` in registry.json. **Still worth doing**, lower
priority now that the live check exists: find an actually-current bulk source for this
CSV itself (the `omawww.../ListCompleta69B.html` listing page redirects to a
SharePoint-style JS-rendered index that doesn't scrape with `curl`; try rendering it with
a headless browser, or check whether `datos.gob.mx`'s `contribuyentes_incumplidos`
dataset is fresher) so the Presunto/Desvirtuado/Sentencia Favorable tiers aren't stuck on
a one-time snapshot either.

## Re-fetch commands

```bash
# XSD tree
BASE="https://raw.githubusercontent.com/phpcfdi/resources-sat-xml/master/resources/www.sat.gob.mx/sitio_internet"
curl -sfL -o xsd/cfd/4/cfdv40.xsd "$BASE/cfd/4/cfdv40.xsd"
curl -sfL -o xsd/cfd/catalogos/catCFDI.xsd "$BASE/cfd/catalogos/catCFDI.xsd"
curl -sfL -o xsd/cfd/tipoDatos/tdCFDI/tdCFDI.xsd "$BASE/cfd/tipoDatos/tdCFDI/tdCFDI.xsd"
curl -sfL -o xsd/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd "$BASE/cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd"

# Catalogs — check https://github.com/phpcfdi/resources-sat-catalogs/releases/latest for the current tag first
curl -sfL -o catalogs/catalogs.db.bz2 "https://github.com/phpcfdi/resources-sat-catalogs/releases/download/<TAG>/catalogs.db.bz2"
bunzip2 -k catalogs/catalogs.db.bz2

# Anexo 20
curl -sfL -o anexo20/Anexo_20_Guia_de_llenado_CFDI.pdf "http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Anexo_20_Guia_de_llenado_CFDI.pdf"

# 69-B — see freshness gap note above before trusting this as "current"
curl -sfL -o efos/listado_completo_69b.csv "http://omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv"
```

**Note on `omawww.sat.gob.mx`:** HTTPS connections were refused during this fetch (likely
SNI/cert handling on their end); plain HTTP worked for every file. Don't burn time debugging
HTTPS to this specific host — it's a known SAT quirk, not a local network problem.
