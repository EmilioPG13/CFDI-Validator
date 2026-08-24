// The machine-readable pin file: corpus/sources.json. Everything else in this package
// decides "what changed upstream" by comparing live upstream state against what this
// file records. The watcher's PR is the only writer of this file -- hand edits are for
// initial bootstrap and emergencies only.
import { readFileSync, writeFileSync } from "node:fs";

export interface CatalogsPin {
  repo: string;
  asset: string;
  release: string;
  fetched: string;
  sha256: string;
  trackedPath: string;
}

export interface XsdPin {
  repo: string;
  ref: string;
  checked: string;
  files: Record<string, string>;
  upstreamBase: string;
}

export interface Anexo20Pin {
  url: string;
  note?: string;
  checked: string;
  sha256: string;
  trackedPath: string;
}

export interface EfosPin {
  url: string;
  encoding: string;
  note?: string;
  checked: string;
  sha256: string;
  trackedPath: string;
}

export interface SourcesFile {
  $comment?: string;
  catalogs: CatalogsPin;
  xsd: XsdPin;
  anexo20: Anexo20Pin;
  efos: EfosPin;
}

// Node on Windows resolves file URLs to /C:/... POSIX-style paths that node:fs does not
// open (the CLAUDE.md gotcha). fileURLToPath produces the native form on every platform.
import { fileURLToPath } from "node:url";
const SOURCES_PATH = fileURLToPath(new URL("../../corpus/sources.json", import.meta.url));

export function loadSources(): SourcesFile {
  return JSON.parse(readFileSync(SOURCES_PATH, "utf-8")) as SourcesFile;
}

export function saveSources(next: SourcesFile): void {
  writeFileSync(SOURCES_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}
