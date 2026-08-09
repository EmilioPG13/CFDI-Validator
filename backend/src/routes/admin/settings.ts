// Generic AppSetting CRUD, with two special-cased keys (model.explainer, model.verifier)
// that carry extra enforcement -- the health-check gate (assertModelHealthyForRole) and
// the different-model-family constraint (assertDifferentModelFamily) are both REAL
// checks that reject a write, not UI hints a form could bypass.
import express from "express";
import { resolveSetting, writeSetting, resetSetting } from "../../settings/resolver.ts";
import { assertModelAllowed, ModelNotAllowedError } from "../../llm/modelCatalog.ts";
import { assertModelHealthyForRole, ModelNotHealthyError, type LlmRoleName } from "../../llm/healthProbe.ts";
import { assertDifferentModelFamily, SameModelFamilyError } from "../../prompts/verifier.ts";
import { DEFAULT_EXPLAINER_MODEL, DEFAULT_VERIFIER_MODEL } from "../../jobs/processor.ts";

export const adminSettingsRouter = express.Router();

// The known-settings registry: every key this admin console can read/write, with its
// code default. resolveSetting() needs a default per key -- deliberately not "any string
// key is writable," so a typo'd key can't silently create an orphaned AppSetting row.
const KNOWN_SETTINGS: Record<string, string> = {
  "model.explainer": DEFAULT_EXPLAINER_MODEL,
  "model.verifier": DEFAULT_VERIFIER_MODEL,
};

const MODEL_ROLE_FOR_KEY: Record<string, LlmRoleName> = {
  "model.explainer": "EXPLAINER",
  "model.verifier": "VERIFIER",
};

adminSettingsRouter.get("/settings/:key", async (req, res) => {
  const { key } = req.params;
  if (!(key in KNOWN_SETTINGS)) {
    res.status(404).json({ error: `Unknown setting key: ${key}` });
    return;
  }
  const resolution = await resolveSetting(key, KNOWN_SETTINGS[key]);
  res.json(resolution);
});

adminSettingsRouter.put("/settings/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body ?? {};
  if (!(key in KNOWN_SETTINGS)) {
    res.status(404).json({ error: `Unknown setting key: ${key}` });
    return;
  }
  if (typeof value !== "string" || !value) {
    res.status(400).json({ error: "value (non-empty string) is required" });
    return;
  }

  const role = MODEL_ROLE_FOR_KEY[key];
  if (role) {
    try {
      await assertModelAllowed(value);
      await assertModelHealthyForRole(value, role);

      const otherKey = role === "EXPLAINER" ? "model.verifier" : "model.explainer";
      const other = await resolveSetting(otherKey, KNOWN_SETTINGS[otherKey]);
      const explainerModel = role === "EXPLAINER" ? value : other.value;
      const verifierModel = role === "VERIFIER" ? value : other.value;
      assertDifferentModelFamily(explainerModel, verifierModel);
    } catch (err) {
      if (err instanceof ModelNotAllowedError || err instanceof ModelNotHealthyError || err instanceof SameModelFamilyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  }

  // req.user is guaranteed set here -- this route is mounted behind requireAuth in
  // routes/admin/index.ts.
  await writeSetting(key, value, req.user!.userId);
  const resolution = await resolveSetting(key, KNOWN_SETTINGS[key]);
  res.json(resolution);
});

adminSettingsRouter.delete("/settings/:key", async (req, res) => {
  const { key } = req.params;
  if (!(key in KNOWN_SETTINGS)) {
    res.status(404).json({ error: `Unknown setting key: ${key}` });
    return;
  }
  await resetSetting(key);
  res.status(204).end();
});
