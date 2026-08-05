// postinstall: corpus/catalogs/catalogs.db (97 MB decompressed) is gitignored — too
// close to GitHub's 100 MB hard per-file limit, and there's no reason to track an
// uncompressed, regenerable binary in git history. The compressed .bz2 (25 MB) is
// tracked instead; this decompresses it on install so `npm install` alone is enough
// to get a runnable engine/ on a fresh clone, with no external `bunzip2` binary
// required (pure-JS via unbzip2-stream — a plain Windows machine without git-bash
// or WSL won't reliably have `bunzip2` on PATH).
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import bz2 from "unbzip2-stream";

const catalogsDir = path.resolve(import.meta.dirname, "../../corpus/catalogs");
const compressed = path.join(catalogsDir, "catalogs.db.bz2");
const decompressed = path.join(catalogsDir, "catalogs.db");

if (existsSync(decompressed)) {
  process.exit(0);
}

if (!existsSync(compressed)) {
  console.warn(
    `[ensure-catalogs-db] ${compressed} not found — corpus/ may not be fetched yet. ` +
      "See corpus/README.md's re-fetch commands. Rule-engine tests that touch catalogs.db will fail until this exists.",
  );
  process.exit(0); // don't fail the whole `npm install` over missing corpus data
}

console.log("[ensure-catalogs-db] Decompressing catalogs.db.bz2 -> catalogs.db ...");
await pipeline(createReadStream(compressed), bz2(), createWriteStream(decompressed));
console.log("[ensure-catalogs-db] Done.");
