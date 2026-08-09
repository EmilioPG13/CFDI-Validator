// Structural guard, not a comment: settings/repo.ts is the ONLY file allowed to touch the
// AppSetting table. This is what makes "cache invalidates on every write path" an actual
// guarantee rather than a convention -- cv-tailor's own admin.js PUT handler is the one
// and only place that calls invalidateSettingsCache(), and nothing stops a second write
// path from forgetting to. Here, there structurally cannot be a second write path: if
// anyone ever adds one, this test fails at commit time, not in production five months
// later when a stored setting silently stops responding to writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(import.meta.dirname, "../src");
const ALLOWED_FILE = path.join(SRC_DIR, "settings", "repo.ts");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("no file under src/ other than settings/repo.ts references prisma.appSetting", () => {
  const offenders: string[] = [];
  for (const file of collectTsFiles(SRC_DIR)) {
    if (file === ALLOWED_FILE) continue;
    const content = readFileSync(file, "utf-8");
    if (content.includes("prisma.appSetting")) {
      offenders.push(path.relative(SRC_DIR, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Only settings/repo.ts may touch prisma.appSetting directly -- found it in: ${offenders.join(", ")}. ` +
      "Use settings/resolver.ts's resolveSetting/writeSetting/resetSetting instead.",
  );
});
