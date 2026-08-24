// The central "what changed upstream" structure every other module contributes to and
// every consumer (narration, report, PR, local write-out) reads from. Kept free of I/O
// so tests can construct one synthetically.
import type { CatalogDiff, ReleaseInfo } from "./catalogsWatch.ts";
import type { XsdCheck } from "./xsdWatch.ts";
import type { Anexo20Check } from "./anexo20Watch.ts";
import type { EfosDiff } from "./efosWatch.ts";
import type { NarrationResult } from "./narrate.ts";

export interface CatalogsChange {
  newRelease: string;
  publishedAt: string | null;
  diff: CatalogDiff;
  newBz2: Uint8Array;
}

export interface XsdChangeSet {
  check: XsdCheck;
  files: Map<string, Uint8Array>;
}

export interface Anexo20Change {
  check: Anexo20Check;
  pdf: Uint8Array;
}

export interface EfosChange {
  diff: EfosDiff | null;
  csv: Uint8Array;
  sha256: string;
}

export interface ChangeSet {
  detectedAt: string;
  catalogs: CatalogsChange | null;
  xsd: XsdChangeSet | null;
  anexo20: Anexo20Change | null;
  efos: EfosChange | null;
  // Set only after narrateDiff ran; resumen may still be null (grounding failed twice).
  narration: NarrationResult | null;
  model: string | null;
}

export function hasAnyChanges(cs: ChangeSet): boolean {
  return (
    cs.catalogs !== null ||
    cs.xsd !== null ||
    cs.anexo20 !== null ||
    cs.efos !== null
  );
}
