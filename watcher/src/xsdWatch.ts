// XSD tree watch: the four-file CFDI schema tree is mirrored from
// phpcfdi/resources-sat-xml@master (unversioned -- it tracks whatever SAT publishes).
// Hash comparison only: if bytes change, the whole file goes into the PR and a human
// decides whether any rule needs to move. There is nothing smarter to compute here --
// an XSD change's *meaning* is exactly what the human review step exists for.
import { fetchBuffer } from "./http.ts";
import { sha256Hex } from "./http.ts";

export interface XsdChange {
  trackedPath: string;
  upstreamUrl: string;
  oldSha256: string | null;
  newSha256: string;
}

export interface XsdCheck {
  changed: boolean;
  changes: XsdChange[];
  checkedAt: string;
}

/** trackedPath looks like "corpus/xsd/cfd/4/cfdv40.xsd"; its upstream URL is the same
 *  path minus the leading "corpus/xsd/" prefix, under sources.xsd.upstreamBase. If that
 *  mapping ever breaks (upstream restructures), this fails loudly with the URL it tried,
 *  rather than silently hashing a 404 page. */
export function xsdUpstreamUrl(upstreamBase: string, trackedPath: string): string {
  const prefix = "corpus/xsd/";
  if (!trackedPath.startsWith(prefix)) {
    throw new Error(`XSD trackedPath "${trackedPath}" doesn't start with "${prefix}" -- sources.json layout drift.`);
  }
  return `${upstreamBase.replace(/\/$/, "")}/${trackedPath.slice(prefix.length)}`;
}

export async function checkXsd(
  pin: { files: Record<string, string>; upstreamBase: string },
): Promise<{ check: XsdCheck; updatedFiles: Map<string, Uint8Array> }> {
  const changes: XsdChange[] = [];
  const updated = new Map<string, Uint8Array>();

  for (const [trackedPath, oldSha] of Object.entries(pin.files)) {
    const url = xsdUpstreamUrl(pin.upstreamBase, trackedPath);
    const bytes = await fetchBuffer(url);
    const newSha = sha256Hex(bytes);
    if (newSha !== oldSha) {
      changes.push({ trackedPath, upstreamUrl: url, oldSha256: oldSha, newSha256: newSha });
      updated.set(trackedPath, bytes);
    }
  }

  return { check: { changed: changes.length > 0, changes, checkedAt: new Date().toISOString() }, updatedFiles: updated };
}
