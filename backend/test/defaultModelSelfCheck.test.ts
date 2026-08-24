import { test } from "node:test";
import assert from "node:assert/strict";
import { findStaleModels, formatStaleWarning, type ModelUsageResolution } from "../src/llm/defaultModelSelfCheck.ts";

const RESOLUTIONS: ModelUsageResolution[] = [
  { settingKey: "model.explainer", role: "EXPLAINER", source: "default", modelId: "alive/model-a" },
  { settingKey: "model.verifier", role: "VERIFIER", source: "stored", modelId: "dead/model-b" },
];

const CATALOG = new Set(["alive/model-a"]);

test("flags only models absent from the live catalog", () => {
  const stale = findStaleModels(RESOLUTIONS, CATALOG);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].modelId, "dead/model-b");
  assert.equal(stale[0].role, "VERIFIER");
});

test("the warning distinguishes a stored override from a code default", () => {
  const [stored] = findStaleModels(RESOLUTIONS, CATALOG);
  assert.match(formatStaleWarning(stored), /stored setting model\.verifier/);
  assert.match(formatStaleWarning(stored), /from \/admin/);

  const [codeDefault] = findStaleModels(
    [{ settingKey: "model.explainer", role: "EXPLAINER", source: "default", modelId: "dead/model-c" }],
    CATALOG,
  );
  assert.match(formatStaleWarning(codeDefault), /code-level default/);
  assert.match(formatStaleWarning(codeDefault), /src\/jobs\/processor\.ts/);
});
