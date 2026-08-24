// 69-B / EFOS watch -- the one source where a hash comparison alone would be dishonest.
// The list self-declares its as-of date in its header, and the SAT re-publishes it with
// the SAME bytes-plus-new-date pattern often enough that "file changed" and "the list
// actually moved" are different questions. So: parse both sides with sat-client's own
// loader (one parser, never a second one that can drift), diff RFC->situación maps, and
// report the declared dates explicitly. This is also what keeps the Presunto /
// Desvirtuado / Sentencia Favorable tiers fresh -- the live per-invoice
// ConsultaCFDIService.ValidacionEFOS check only covers "Definitivo" (see
// engine/src/rules/emisorEfos69bSat.ts).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEfosIndex, type EfosRecord, type EfosSituacion } from "../../sat-client/src/efosIndex.ts";
import { fetchBuffer } from "./http.ts";
import { sha256Hex } from "./http.ts";

// Last row wins per RFC -- deliberately mirrors the dedup semantics the engine's own
// EfosIndex documents (sat-client/src/efosIndex.ts), so this diff describes exactly the
// view the rule engine would see, not some idealized version of the file.
function toMap(records: EfosRecord[]): Map<string, EfosRecord> {
  const map = new Map<string, EfosRecord>();
  for (const r of records) map.set(r.rfc, r);
  return map;
}

export interface EfosDiff {
  declaredDateBefore: string | null;
  declaredDateAfter: string | null;
  added: { rfc: string; nombreContribuyente: string; situacion: EfosSituacion }[];
  removed: { rfc: string; nombreContribuyente: string; situacion: EfosSituacion }[];
  situationChanges: { rfc: string; nombreContribuyente: string; before: EfosSituacion; after: EfosSituacion }[];
  totalBefore: number;
  totalAfter: number;
}

export function hasEfosChanges(diff: EfosDiff): boolean {
  return (
    diff.declaredDateBefore !== diff.declaredDateAfter ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.situationChanges.length > 0
  );
}

export function diffEfosRecords(
  beforeBytes: Uint8Array,
  afterBytes: Uint8Array,
): EfosDiff {
  const beforeIdx = loadEfosIndex(beforeBytes);
  const afterIdx = loadEfosIndex(afterBytes);
  const before = toMap(beforeIdx.records);
  const after = toMap(afterIdx.records);

  const added: EfosDiff["added"] = [];
  const removed: EfosDiff["removed"] = [];
  const situationChanges: EfosDiff["situationChanges"] = [];

  for (const [rfc, rec] of after) {
    const old = before.get(rfc);
    if (!old) {
      added.push({ rfc, nombreContribuyente: rec.nombreContribuyente, situacion: rec.situacion });
    } else if (old.situacion !== rec.situacion) {
      situationChanges.push({
        rfc,
        nombreContribuyente: rec.nombreContribuyente,
        before: old.situacion,
        after: rec.situacion,
      });
    }
  }
  for (const [rfc, rec] of before) {
    if (!after.has(rfc)) {
      removed.push({ rfc, nombreContribuyente: rec.nombreContribuyente, situacion: rec.situacion });
    }
  }

  return {
    declaredDateBefore: beforeIdx.meta.informacionActualizadaAl,
    declaredDateAfter: afterIdx.meta.informacionActualizadaAl,
    added,
    removed,
    situationChanges,
    totalBefore: before.size,
    totalAfter: after.size,
  };
}

export async function checkEfos(pin: {
  url: string;
  sha256: string;
  trackedPath: string;
}): Promise<{ changed: boolean; diff?: EfosDiff; newCsv?: Uint8Array; newSha256: string }> {
  const bytes = await fetchBuffer(pin.url);
  const newSha = sha256Hex(bytes);
  if (newSha === pin.sha256) {
    return { changed: false, newSha256: newSha };
  }

  // The current tracked file may be absent on a fresh clone without corpus data --
  // in that case there is nothing to diff against, but the refresh itself is still real.
  const currentPath = fileURLToPath(new URL(`../../${pin.trackedPath}`, import.meta.url));
  let currentBytes: Uint8Array | null = null;
  try {
    currentBytes = await readFile(currentPath);
  } catch {
    currentBytes = null;
  }

  if (!currentBytes) {
    return { changed: true, newCsv: bytes, newSha256: newSha };
  }

  return { changed: true, diff: diffEfosRecords(currentBytes, bytes), newCsv: bytes, newSha256: newSha };
}
