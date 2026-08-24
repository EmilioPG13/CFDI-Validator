// Everything the watcher produces for humans: console summary, PR body, the
// docs/watcher/ report file, the narration facts payload, and the mechanical updates to
// files whose provenance constants live in code (sources.json, build-catalog-bundle.mjs).
//
// Deliberate non-feature: this module does NOT rewrite corpus/README.md's prose. Its
// provenance paragraphs are written commentary ("five days before this fetch...") that a
// script can only mangle; the PR body instead carries an explicit human checklist item
// for it. sources.json is the machine truth, build-catalog-bundle.mjs's two constants
// are safe single-line replacements, and everything else waits for the human reviewer --
// same "never auto-merge" philosophy as the PR itself.
import { sha256Hex } from "./http.ts";
import type { ChangeSet } from "./changeset.ts";
import { hasAnyChanges } from "./changeset.ts";
import type { SourcesFile } from "./sources.ts";
import type { NarrationFacts } from "./narrate.ts";
import type { TableDiff } from "./catalogsWatch.ts";

export function summarizeChanges(cs: ChangeSet): string[] {
  const lines: string[] = [];
  if (cs.catalogs) {
    const d = cs.catalogs.diff;
    lines.push(`catalogs: ${d.oldRelease} -> ${cs.catalogs.newRelease}`);
    if (d.newTables.length) lines.push(`  new tables: ${d.newTables.join(", ")}`);
    if (d.droppedTables.length) lines.push(`  dropped tables: ${d.droppedTables.join(", ")}`);
    for (const t of d.tables) {
      lines.push(`  ${t.table}: +${t.added.length} / -${t.removed.length} / ~${t.changed.length}`);
    }
    if (!d.tables.length && !d.newTables.length && !d.droppedTables.length) {
      lines.push("  (release tag moved with no cfdi_40_* row changes)");
    }
  }
  if (cs.xsd) {
    lines.push(`xsd: ${cs.xsd.check.changes.length} file(s) changed`);
    for (const c of cs.xsd.check.changes) lines.push(`  ${c.trackedPath}`);
  }
  if (cs.anexo20) {
    lines.push(`anexo20: PDF bytes changed (${cs.anexo20.check.oldSha256.slice(0, 8)} -> ${cs.anexo20.check.newSha256.slice(0, 8)})`);
  }
  if (cs.efos) {
    const d = cs.efos.diff;
    if (d) {
      lines.push(
        `efos: declared date ${d.declaredDateBefore ?? "?"} -> ${d.declaredDateAfter ?? "?"}; ` +
          `+${d.added.length} / -${d.removed.length} / ~${d.situationChanges.length} (total ${d.totalBefore} -> ${d.totalAfter})`,
      );
    } else {
      lines.push("efos: CSV bytes changed but no prior copy existed locally to diff against");
    }
  }
  if (!hasAnyChanges(cs)) lines.push("no changes detected");
  return lines;
}

/** Bounded facts payload for the narrator: full counts everywhere, at most five real
 *  rows per table as examples. Everything included here is automatically inside the
 *  narration's grounding set, since grounding is built from the serialized payload. */
export function buildNarrationFacts(cs: ChangeSet, samplesPerTable = 5): NarrationFacts {
  const facts: NarrationFacts = {};
  const sampleRow = (row: Record<string, string | null>): Record<string, string | null> =>
    Object.fromEntries(Object.entries(row).slice(0, 6));

  // Exact display names of every changed source, so the narrator can mention them
  // without tripping its own grounding check ("Anexo" is free prose, but the "20" in
  // "Anexo 20" is a number and must exist in the payload it came from).
  facts.fuentes_cambiadas = [
    ...(cs.catalogs ? ["Catálogos"] : []),
    ...(cs.xsd ? ["XSD"] : []),
    ...(cs.anexo20 ? ["Anexo 20"] : []),
    ...(cs.efos ? ["Listado 69-B"] : []),
  ];

  if (cs.catalogs) {
    const d = cs.catalogs.diff;
    const tables = d.tables.map((t: TableDiff) => ({
      tabla: t.table,
      altas: t.added.length,
      bajas: t.removed.length,
      modificados: t.changed.length,
      ejemplos_altas: t.added.slice(0, samplesPerTable).map(sampleRow),
      ejemplos_bajas: t.removed.slice(0, samplesPerTable).map(sampleRow),
      ejemplos_cambios: t.changed.slice(0, samplesPerTable).map((c) => ({
        id: c.id,
        cambios: c.changes.map((ch) => ({ columna: ch.column, antes: ch.before, despues: ch.after })),
      })),
    }));
    facts.catalogs = {
      release_anterior: d.oldRelease,
      release_nueva: cs.catalogs.newRelease,
      publicada: cs.catalogs.publishedAt,
      // Counts are precomputed HERE, not left for the model to derive: the grounding
      // check is textual, so a true-but-derived statement ("24 tablas sin cambios")
      // gets rejected unless the number literally exists in this payload. Caught live
      // on the first real narration attempt (2026-08-23).
      tablas_comparadas_total: d.tablesCompared.length,
      tablas_sin_cambios_total: d.unchangedTables.length,
      tablas_con_cambios_total: d.tables.length,
      altas_totales: d.tables.reduce((n, t) => n + t.added.length, 0),
      bajas_totales: d.tables.reduce((n, t) => n + t.removed.length, 0),
      modificados_totales: d.tables.reduce((n, t) => n + t.changed.length, 0),
      tablas_nuevas: d.newTables,
      tablas_eliminadas: d.droppedTables,
      tablas: tables,
      tablas_sin_cambios: d.unchangedTables,
    };
  }

  if (cs.efos?.diff) {
    const d = cs.efos.diff;
    const cap = (n: number) => n > 200 ? 200 : n;
    facts.efos = {
      fecha_declarada_anterior: d.declaredDateBefore,
      fecha_declarada_nueva: d.declaredDateAfter,
      total_antes: d.totalBefore,
      total_despues: d.totalAfter,
      agregados: d.added.slice(0, cap(d.added.length)).map((r) => ({ rfc: r.rfc, nombre: r.nombreContribuyente, situacion: r.situacion })),
      removidos: d.removed.slice(0, cap(d.removed.length)).map((r) => ({ rfc: r.rfc, nombre: r.nombreContribuyente, situacion: r.situacion })),
      cambios_situacion: d.situationChanges.slice(0, cap(d.situationChanges.length)).map((r) => ({
        rfc: r.rfc, nombre: r.nombreContribuyente, antes: r.before, despues: r.after,
      })),
      agregados_total: d.added.length,
      removidos_total: d.removed.length,
      cambios_situacion_total: d.situationChanges.length,
    };
  }

  if (cs.xsd) {
    facts.xsd = {
      archivos_cambiados: cs.xsd.check.changes.map((c) => ({
        ruta: c.trackedPath,
        sha256_anterior: c.oldSha256,
        sha256_nuevo: c.newSha256,
      })),
    };
  }

  if (cs.anexo20) {
    facts.anexo20 = {
      sha256_anterior: cs.anexo20.check.oldSha256,
      sha256_nuevo: cs.anexo20.check.newSha256,
    };
  }

  return facts;
}

export function nextSources(prev: SourcesFile, cs: ChangeSet): SourcesFile {
  const next: SourcesFile = structuredClone(prev);
  if (cs.catalogs) {
    next.catalogs.release = cs.catalogs.newRelease;
    next.catalogs.sha256 = sha256Hex(cs.catalogs.newBz2);
    next.catalogs.fetched = cs.detectedAt.slice(0, 10);
  }
  if (cs.xsd) {
    next.xsd.checked = cs.detectedAt.slice(0, 10);
    for (const [trackedPath, bytes] of cs.xsd.files) {
      // Hash recomputed here rather than carried from the check -- one source of truth
      // (these exact bytes), not two that could diverge.
      next.xsd.files[trackedPath] = sha256Hex(bytes);
    }
  }
  if (cs.anexo20) {
    next.anexo20.checked = cs.detectedAt.slice(0, 10);
    next.anexo20.sha256 = sha256Hex(cs.anexo20.pdf);
  }
  if (cs.efos) {
    next.efos.checked = cs.detectedAt.slice(0, 10);
    next.efos.sha256 = cs.efos.sha256;
  }
  return next;
}

// --- Provenance constants in code --------------------------------------------------------

const BUNDLE_RELEASE_RE = /const SOURCE_RELEASE = "[^"]*";/;
const BUNDLE_FETCHED_RE = /const SOURCE_FETCHED = "[^"]*";/;

/** Rewrites engine/scripts/build-catalog-bundle.mjs's two provenance constants so the
 *  browser bundle's manifest reflects the new release after the PR merges (the bundle
 *  itself is gitignored and regenerated on npm install). Throws if the anchors aren't
 *  found -- a silent skip here would ship a bundle whose manifest lies about its source. */
export function updateBundleConstants(bundleScriptText: string, cs: ChangeSet): string {
  if (!cs.catalogs) return bundleScriptText;
  let out = bundleScriptText;
  const release = `const SOURCE_RELEASE = "phpcfdi/resources-sat-catalogs ${cs.catalogs.newRelease}";`;
  const fetched = `const SOURCE_FETCHED = "${cs.detectedAt.slice(0, 10)}";`;
  if (!BUNDLE_RELEASE_RE.test(out) || !BUNDLE_FETCHED_RE.test(out)) {
    throw new Error("build-catalog-bundle.mjs provenance constants not found -- file layout changed; update watcher/report.ts");
  }
  out = out.replace(BUNDLE_RELEASE_RE, release);
  out = out.replace(BUNDLE_FETCHED_RE, fetched);
  return out;
}

// --- Human-facing documents ---------------------------------------------------------------

export function prTitle(cs: ChangeSet): string {
  const parts: string[] = [];
  if (cs.catalogs) parts.push(`catálogos ${cs.catalogs.diff.oldRelease}→${cs.catalogs.newRelease}`);
  if (cs.xsd) parts.push(`${cs.xsd.check.changes.length} XSD`);
  if (cs.anexo20) parts.push("Anexo 20");
  if (cs.efos) parts.push("69-B");
  return `chore(corpus): actualización de fuentes SAT (${parts.join(", ")})`;
}

export function buildPrBody(cs: ChangeSet, narrationResumen: string | null): string {
  const lines: string[] = [];
  lines.push("Actualización automática de las fuentes públicas del SAT que el motor usa como verdad de suelo (`corpus/sources.json` es la referencia legible por máquina). **Este PR nunca se mezcla solo** — un humano revisa y decide.");
  lines.push("");
  lines.push("## Qué cambió");
  lines.push("");
  lines.push("```");
  lines.push(...summarizeChanges(cs));
  lines.push("```");
  lines.push("");

  if (narrationResumen) {
    lines.push("## Resumen generado por IA (verificado contra el diff)");
    lines.push("");
    lines.push("> Cada número, código y fecha de este resumen fue validado determinísticamente contra los datos del diff (grounding). El modelo no puede afirmar causas ni consecuencias.");
    lines.push("");
    lines.push(narrationResumen);
    lines.push("");
  } else if (cs.narration) {
    lines.push("## Resumen generado por IA");
    lines.push("");
    lines.push("_No incluido: la narración no pasó el chequeo determinístico de grounding en dos intentos. El diff estructurado de arriba es la fuente confiable._");
    lines.push("");
  }

  lines.push("## Checklist del revisor humano");
  lines.push("");
  lines.push("- [ ] Si cambiaron catálogos: revisar si alguna regla del motor (`engine/src/rules/`, specs en `engine/rules/registry.json`) necesita actualizarse o añadirse con su fixture par.");
  lines.push("- [ ] Actualizar a mano las fechas/comentario de procedencia en `corpus/README.md` (el watcher no reescribe prosa a propósito).");
  lines.push("- [ ] Tras el merge: correr `npm install` en `engine/` para regenerar `catalog-bundle/` desde el nuevo `catalogs.db`.");
  lines.push("- [ ] Si cambió el listado 69-B: recordar que el tier Presunto/Desvirtuado/Sentencia ahora refleja esta fecha declarada; `emisor-efos-69b-sat` sigue cubriendo 'Definitivo' en vivo.");
  return lines.join("\n");
}

export function buildReportMarkdown(cs: ChangeSet, narrationResumen: string | null): string {
  const date = cs.detectedAt.slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Catalog Watcher report — ${date}`);
  lines.push("");
  lines.push(`Detected at: ${cs.detectedAt}`);
  lines.push(`Model used for narration: ${cs.model ?? "none"}`);
  lines.push("");
  lines.push("## Structured changes");
  lines.push("");
  lines.push("```");
  lines.push(...summarizeChanges(cs));
  lines.push("```");
  lines.push("");

  if (cs.catalogs) {
    const d = cs.catalogs.diff;
    lines.push("<details><summary>Full catalogs diff detail</summary>");
    lines.push("");
    for (const t of d.tables) {
      lines.push(`### ${t.table}`);
      lines.push("");
      for (const row of t.added.slice(0, 50)) {
        lines.push(`+ ${JSON.stringify(row)}`);
      }
      if (t.added.length > 50) lines.push(`+ ... and ${t.added.length - 50} more added rows`);
      for (const row of t.removed.slice(0, 50)) {
        lines.push(`- ${JSON.stringify(row)}`);
      }
      if (t.removed.length > 50) lines.push(`- ... and ${t.removed.length - 50} more removed rows`);
      for (const ch of t.changed.slice(0, 100)) {
        for (const c of ch.changes) {
          lines.push(`~ ${ch.id}: ${c.column}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
        }
      }
      if (t.changed.length > 100) lines.push(`~ ... and ${t.changed.length - 100} more changed rows`);
      lines.push("");
    }
    lines.push("</details>");
    lines.push("");
  }

  if (cs.efos?.diff) {
    const d = cs.efos.diff;
    lines.push("<details><summary>Full 69-B diff detail</summary>");
    lines.push("");
    lines.push(`Declared date: ${d.declaredDateBefore ?? "?"} -> ${d.declaredDateAfter ?? "?"}`);
    lines.push(`Totals: ${d.totalBefore} -> ${d.totalAfter}`);
    lines.push("");
    for (const r of d.added) lines.push(`+ ${r.rfc} [${r.situacion}] ${r.nombreContribuyente}`);
    for (const r of d.removed) lines.push(`- ${r.rfc} [${r.situacion}] ${r.nombreContribuyente}`);
    for (const r of d.situationChanges) lines.push(`~ ${r.rfc}: ${r.before} -> ${r.after} (${r.nombreContribuyente})`);
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("## Narración (IA)");
  lines.push("");
  if (narrationResumen) {
    lines.push(narrationResumen);
  } else {
    lines.push("_Sin narración verificable (ver PR para el detalle). El diff estructurado manda._");
  }
  lines.push("");
  return lines.join("\n");
}
