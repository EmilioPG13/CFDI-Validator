// Anexo 20 watch: one PDF, one hash. Same posture as xsdWatch -- detect that the
// official guide changed, ship the new bytes into a PR, let a human read the diff.
// The SAT host here serves plain HTTP only (see corpus/README.md); the URL in
// sources.json already reflects that, so no special-casing in code.
import { fetchBuffer } from "./http.ts";
import { sha256Hex } from "./http.ts";

export interface Anexo20Check {
  changed: boolean;
  oldSha256: string;
  newSha256: string;
  checkedAt: string;
}

export async function checkAnexo20(
  pin: { url: string; sha256: string },
): Promise<{ check: Anexo20Check; newPdf?: Uint8Array }> {
  const bytes = await fetchBuffer(pin.url);
  const newSha = sha256Hex(bytes);
  if (newSha === pin.sha256) {
    return { check: { changed: false, oldSha256: pin.sha256, newSha256: newSha, checkedAt: new Date().toISOString() } };
  }
  return {
    check: { changed: true, oldSha256: pin.sha256, newSha256: newSha, checkedAt: new Date().toISOString() },
    newPdf: bytes,
  };
}
