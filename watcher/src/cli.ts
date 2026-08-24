// Orchestrator. One run = one of two outcomes:
//   - nothing changed upstream -> exit 0, no side effects anywhere
//   - something changed -> a branch + PR (CI) or an on-disk refresh (--local), with the
//     deterministic diff always present and the LLM narration only ever added on top of
//     it, never instead of it.
//
// Assumes it runs from a checkout of the repo (true locally and in Actions): current
// file contents are read from disk, updates go through the GitHub API in PR mode so no
// git identity/config is needed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadSources } from "./sources.ts";
import { buildCatalogDiff, latestCatalogRelease } from "./catalogsWatch.ts";
import { checkXsd } from "./xsdWatch.ts";
import { checkAnexo20 } from "./anexo20Watch.ts";
import { checkEfos } from "./efosWatch.ts";
import { narrateDiff, type NarrationResult } from "./narrate.ts";
import {
  branchExists,
  createBlob,
  createBranch,
  createCommit,
  createPullRequest,
  createTree,
  getBranchSha,
  updateBranch,
  type GhClient,
  type TreeEntry,
} from "./github.ts";
import {
  buildNarrationFacts,
  buildPrBody,
  buildReportMarkdown,
  nextSources,
  prTitle,
  summarizeChanges,
  updateBundleConstants,
} from "./report.ts";
import { hasAnyChanges, type ChangeSet } from "./changeset.ts";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

async function detectChanges(): Promise<ChangeSet> {
  const sources = loadSources();
  const ghToken = env("WATCHER_GITHUB_TOKEN") ?? env("GITHUB_TOKEN") ?? env("GH_TOKEN");
  const detectedAt = new Date().toISOString();

  const [catalogsRel, xsdRes, anexo20Res, efosRes] = await Promise.all([
    latestCatalogRelease(sources.catalogs.repo, ghToken ?? undefined),
    checkXsd(sources.xsd),
    checkAnexo20(sources.anexo20),
    checkEfos(sources.efos),
  ]);

  const cs: ChangeSet = {
    detectedAt,
    catalogs: null,
    xsd: xsdRes.check.changed ? { check: xsdRes.check, files: xsdRes.updatedFiles } : null,
    anexo20: anexo20Res.check.changed && anexo20Res.newPdf ? { check: anexo20Res.check, pdf: anexo20Res.newPdf } : null,
    efos: efosRes.changed && efosRes.newCsv ? { diff: efosRes.diff ?? null, csv: efosRes.newCsv, sha256: efosRes.newSha256 } : null,
    narration: null,
    model: null,
  };

  if (catalogsRel.tag !== sources.catalogs.release) {
    const { diff, newBz2 } = await buildCatalogDiff(
      sources.catalogs.repo,
      { release: sources.catalogs.release },
      catalogsRel,
      ghToken ?? undefined,
    );
    cs.catalogs = { newRelease: catalogsRel.tag, publishedAt: catalogsRel.publishedAt, diff, newBz2 };
  }

  return cs;
}

async function tryNarrate(cs: ChangeSet): Promise<void> {
  const apiKey = env("NVIDIA_API_KEY") ?? env("WATCHER_NIM_API_KEY");
  if (!apiKey) {
    console.log("[watcher] NVIDIA_API_KEY not set -- shipping deterministic diff without narration.");
    return;
  }
  // Default chosen by live health probe 2026-08-23 (fast, honors response_format:
  // json_schema). The previous default z-ai/glm-5.2 went 410 Gone on NIM on
  // 2026-08-21 -- the same stale-code-default failure mode Phase 5e hit with the
  // Verifier model. A code-level default is NOT covered by any admin gate; when this
  // one goes stale, the watcher degrades gracefully: PR ships with the deterministic
  // diff and no narration.
  const model = env("WATCHER_MODEL") ?? "deepseek-ai/deepseek-v4-flash-0731";
  cs.model = model;
  try {
    const facts = buildNarrationFacts(cs);
    const result: NarrationResult = await narrateDiff({ apiKey, model, facts });
    cs.narration = result;
    if (result.resumen === null) {
      console.warn("[watcher] narration failed grounding twice -- PR will ship without it:", JSON.stringify(result.attempts));
    }
  } catch (err) {
    console.warn(`[watcher] narration call failed (${err instanceof Error ? err.message : err}) -- continuing without.`);
  }
}

function writeLocal(cs: ChangeSet): void {
  const sources = loadSources();
  const next = nextSources(sources, cs);
  const rel = (p: string) => path.join(REPO_ROOT, p);

  if (cs.catalogs) writeFileSync(rel("corpus/catalogs/catalogs.db.bz2"), cs.catalogs.newBz2);
  if (cs.xsd) for (const [trackedPath, bytes] of cs.xsd.files) writeFileSync(rel(trackedPath), bytes);
  if (cs.anexo20) writeFileSync(rel(sources.anexo20.trackedPath), cs.anexo20.pdf);
  if (cs.efos) writeFileSync(rel(sources.efos.trackedPath), cs.efos.csv);

  writeFileSync(rel("corpus/sources.json"), `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  const bundlePath = rel("engine/scripts/build-catalog-bundle.mjs");
  writeFileSync(bundlePath, updateBundleConstants(readFileSync(bundlePath, "utf-8"), cs), "utf-8");

  const reportDir = rel("docs/watcher");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${cs.detectedAt.slice(0, 10)}.md`);
  writeFileSync(reportPath, buildReportMarkdown(cs, cs.narration?.resumen ?? null), "utf-8");

  console.log(`[watcher] local refresh written. Report: docs/watcher/${path.basename(reportPath)}`);
}

async function openPullRequest(cs: ChangeSet): Promise<void> {
  const repo = env("GITHUB_REPOSITORY");
  const token = env("WATCHER_GITHUB_TOKEN") ?? env("GITHUB_TOKEN") ?? env("GH_TOKEN");
  if (!repo || !token) {
    throw new Error("PR mode needs GITHUB_REPOSITORY and a token (GITHUB_TOKEN / WATCHER_GITHUB_TOKEN). Use --local for an on-disk refresh.");
  }
  const gh: GhClient = { repo, token };
  const baseBranch = env("WATCHER_BASE_BRANCH") ?? "main";

  const date = cs.detectedAt.slice(0, 10);
  let branch = `catalog-update/${date}`;
  for (let i = 2; await branchExists(gh, branch); i++) {
    branch = `catalog-update/${date}-${i}`;
  }
  await createBranch(gh, branch, baseBranch);

  const sources = loadSources();
  const next = nextSources(sources, cs);
  const files = new Map<string, Uint8Array>();

  if (cs.catalogs) files.set("corpus/catalogs/catalogs.db.bz2", cs.catalogs.newBz2);
  if (cs.xsd) for (const [trackedPath, bytes] of cs.xsd.files) files.set(trackedPath, bytes);
  if (cs.anexo20) files.set(sources.anexo20.trackedPath, cs.anexo20.pdf);
  if (cs.efos) files.set(sources.efos.trackedPath, cs.efos.csv);

  files.set("corpus/sources.json", new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`));

  const bundlePath = "engine/scripts/build-catalog-bundle.mjs";
  const bundleUpdated = updateBundleConstants(readFileSync(path.join(REPO_ROOT, bundlePath), "utf-8"), cs);
  files.set(bundlePath, new TextEncoder().encode(bundleUpdated));

  const reportMd = buildReportMarkdown(cs, cs.narration?.resumen ?? null);
  files.set(`docs/watcher/${date}.md`, new TextEncoder().encode(reportMd));

  const entries: TreeEntry[] = [];
  for (const [filePath, content] of files) {
    entries.push({ path: filePath, blobSha: await createBlob(gh, content) });
  }

  const baseSha = await getBranchSha(gh, baseBranch);
  const treeSha = await createTree(gh, baseSha, entries);
  const commitMessage =
    `chore(corpus): refresh SAT ground-truth sources (${date})\n\n` +
    [...summarizeChanges(cs)].join("\n") +
    "\n\nDeterministic diff by catalog-watcher; narration grounded against the diff payload.";
  const commitSha = await createCommit(gh, commitMessage, treeSha, baseSha);
  await updateBranch(gh, branch, commitSha);

  const pr = await createPullRequest(gh, {
    head: branch,
    base: baseBranch,
    title: prTitle(cs),
    body: buildPrBody(cs, cs.narration?.resumen ?? null),
  });
  console.log(`[watcher] pull request #${pr.number}: ${pr.htmlUrl}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const localMode = args.includes("--local");

  console.log("[watcher] checking upstream sources...");
  const cs = await detectChanges();
  const summary = summarizeChanges(cs);
  for (const line of summary) console.log(`[watcher] ${line}`);

  if (!hasAnyChanges(cs)) {
    console.log("[watcher] nothing to do.");
    return;
  }

  await tryNarrate(cs);

  if (localMode) {
    writeLocal(cs);
  } else {
    await openPullRequest(cs);
  }
}

main().catch((err) => {
  console.error("[watcher] fatal:", err);
  process.exitCode = 1;
});
