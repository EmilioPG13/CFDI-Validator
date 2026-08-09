// PromptVersion CRUD + /activate. Mirrors routes/admin/settings.ts's shape: a
// KNOWN_*_KEYS registry so a typo'd key 404s instead of silently creating an orphaned
// row, and real enforcement (assertPromptStructurallySafe, via prompts/store.ts's
// activatePromptVersion) living in the route, not left as a UI hint.
import express from "express";
import { EXPLAINER_SYSTEM_PROMPT } from "../../prompts/explainer.ts";
import { VERIFIER_SYSTEM_PROMPT } from "../../prompts/verifier.ts";
import { PromptStructureError } from "../../prompts/structuralChecks.ts";
import {
  listPromptVersions,
  createPromptVersion,
  activatePromptVersion,
  deletePromptVersion,
  resolveActivePromptBody,
  PromptVersionNotFoundError,
  ActivePromptDeletionError,
} from "../../prompts/store.ts";

export const adminPromptsRouter = express.Router();

// The known-keys registry: every prompt this admin console can version, with its in-code
// fallback body -- same "not any string key is writable" reasoning as
// routes/admin/settings.ts's KNOWN_SETTINGS.
const KNOWN_PROMPT_KEYS: Record<string, string> = {
  "explainer.system": EXPLAINER_SYSTEM_PROMPT,
  "verifier.system": VERIFIER_SYSTEM_PROMPT,
};

adminPromptsRouter.get("/prompts", (_req, res) => {
  res.json({ keys: Object.keys(KNOWN_PROMPT_KEYS) });
});

adminPromptsRouter.get("/prompts/:key", async (req, res) => {
  const { key } = req.params;
  if (!(key in KNOWN_PROMPT_KEYS)) {
    res.status(404).json({ error: `Unknown prompt key: ${key}` });
    return;
  }
  const [versions, active] = await Promise.all([
    listPromptVersions(key),
    resolveActivePromptBody(key, KNOWN_PROMPT_KEYS[key]),
  ]);
  res.json({ versions, active });
});

adminPromptsRouter.post("/prompts/:key", async (req, res) => {
  const { key } = req.params;
  if (!(key in KNOWN_PROMPT_KEYS)) {
    res.status(404).json({ error: `Unknown prompt key: ${key}` });
    return;
  }
  const { body } = req.body ?? {};
  if (typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "body (non-empty string) is required" });
    return;
  }

  // req.user is guaranteed set here -- this route is mounted behind requireAuth in
  // routes/admin/index.ts.
  const created = await createPromptVersion(key, body, req.user!.userId);
  res.status(201).json(created);
});

adminPromptsRouter.post("/prompts/:id/activate", async (req, res) => {
  const { id } = req.params;
  try {
    const activated = await activatePromptVersion(id);
    res.json(activated);
  } catch (err) {
    if (err instanceof PromptStructureError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof PromptVersionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

adminPromptsRouter.delete("/prompts/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await deletePromptVersion(id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof ActivePromptDeletionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof PromptVersionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});
