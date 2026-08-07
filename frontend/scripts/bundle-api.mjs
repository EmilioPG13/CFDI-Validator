// Pre-bundles frontend/api-src/*.ts into self-contained frontend/api/*.js files before
// Vercel's own build ever sees them -- necessary, not optional, per two real failed deploys
// (Phase 4g). Vercel's zero-config API function builders do NOT do full esbuild-style
// dependency bundling for a relative import living outside the function's own directory
// (this project's api-src/consulta-sat.ts imports ../../sat-client/src/consultaCfdi.ts):
//   - Edge runtime: fails at DEPLOY time -- NOW_SANDBOX_WORKER_EDGE_FUNCTION_UNSUPPORTED_MODULES,
//     "referencing unsupported modules: .../consulta-sat.js: ../../sat-client/src/consultaCfdi.ts"
//   - Node.js runtime: deploys fine, then fails at RUNTIME -- Vercel transpiles only the
//     entrypoint .ts -> .js, but leaves the transitive .ts import unresolved, so the deployed
//     function crashes with ERR_MODULE_NOT_FOUND the first time it's invoked.
// Both confirmed live, not assumed. The fix: make the file Vercel finds under api/ already
// fully self-contained (every local import inlined) BEFORE Vercel's own function detection
// runs -- there is then nothing left for its bundler/tracer to fail on.
//
// api/ itself is now 100% generated output (gitignored, see .gitignore) -- api-src/ is the
// real, hand-authored, tested source. Same "cheap to regenerate, dangerous to let drift if
// committed" reasoning already applied elsewhere in this repo (engine/catalog-bundle/,
// frontend/public/xsd/, etc.). Wired into prebuild alongside sync-static-assets.mjs so both
// run before Vercel's automatic api/ scan, same as they do before `vite build`.
//
// sat-client has zero external dependencies and consultaCfdi.ts's only local import is
// rateLimiter.ts (also zero imports) -- so this bundle has nothing to resolve beyond two
// small local files. If a future api-src/ entrypoint needs an actual npm package, esbuild's
// `bundle: true` already handles that too (this isn't a special case for sat-client only).
import { build } from "esbuild";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC_DIR = path.join(ROOT, "api-src");
const OUT_DIR = path.join(ROOT, "api");

const entryPoints = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => path.join(SRC_DIR, f));

if (entryPoints.length === 0) {
  console.warn(`[bundle-api] No entrypoints found under ${SRC_DIR} -- nothing to bundle.`);
  process.exit(0);
}

// Only clear previously generated .js/.js.map -- README.md (hand-written, git-tracked)
// lives in the same directory and must survive.
if (existsSync(OUT_DIR)) {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.endsWith(".js") || f.endsWith(".js.map")) rmSync(path.join(OUT_DIR, f));
  }
}
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints,
  outdir: OUT_DIR,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // platform: "node" (above) already makes node: built-ins externally resolvable --
  // Vercel's Node.js Functions run as real ESM modules with them available (see
  // api-src/consulta-sat.ts's own header comment on the Edge -> Node.js switch). Nothing
  // here currently needs one, but don't fight it if a future entrypoint does.
  sourcemap: true,
  logLevel: "info",
});

for (const entry of entryPoints) {
  const name = path.basename(entry, ".ts");
  console.log(`[bundle-api] ${path.relative(ROOT, entry)} -> ${path.relative(ROOT, path.join(OUT_DIR, `${name}.js`))}`);
}
