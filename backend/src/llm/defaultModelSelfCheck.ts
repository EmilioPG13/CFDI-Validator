// Boot-time self-check for model defaults -- closes the structural gap that let stale
// code-level defaults ship invisibly TWICE:
//
//   Phase 5e: DEFAULT_VERIFIER_MODEL mistralai/mistral-medium-3.5-128b -> 410 Gone,
//   caught only because a human reset a setting during production verification.
//   2026-08-23: DEFAULT_EXPLAINER_MODEL z-ai/glm-5.2 -> 410 Gone on NIM as of
//   2026-08-21T09:00Z, discovered by the catalog-watcher's narration attempt failing.
//
// The admin health-check gate never sees these: it fires on an explicit PUT, and a
// default that was healthy when written simply rots silently. This module runs once per
// process start (Render free tier wakes are the real cadence), asks NIM's live catalog
// about every model id that WOULD be used right now (code defaults AND stored overrides),
// and screams in the logs when one is gone. It deliberately does NOT auto-fix -- swapping
// a model changes output quality and licensing posture, a human decision; it also does
// NOT touch the ModelCatalog table (a waking dyno would otherwise write a row every
// spin-up).
import { provider } from "./rateLimitedProvider.ts";
import { DEFAULT_EXPLAINER_MODEL, DEFAULT_VERIFIER_MODEL } from "../jobs/processor.ts";
import { resolveSetting } from "../settings/resolver.ts";
import type { SettingsRepo } from "../settings/repo.ts";
import type { SettingsCache } from "../settings/cache.ts";

export interface ModelUsageResolution {
  settingKey: string;
  role: string;
  source: "stored" | "default";
  modelId: string;
}

export interface StaleModelWarning extends ModelUsageResolution {
  reason: "not-in-catalog";
}

/** Pure core, testable with zero network/DB: given what each role WOULD use and the live
 *  catalog ids, list every id that no longer exists upstream. */
export function findStaleModels(
  resolutions: ModelUsageResolution[],
  catalogIds: ReadonlySet<string>,
): StaleModelWarning[] {
  return resolutions.filter((r) => !catalogIds.has(r.modelId)).map((r) => ({ ...r, reason: "not-in-catalog" as const }));
}

export function formatStaleWarning(w: StaleModelWarning): string {
  return (
    `[self-check] STALE MODEL: ${w.role} would use "${w.modelId}" (${w.source === "stored" ? `stored setting ${w.settingKey}` : "code-level default"}) ` +
    `but it is not in NIM's live catalog -- calls with it will fail (likely HTTP 410). ` +
    (w.source === "stored"
      ? `Assign a current model to ${w.settingKey} from /admin.`
      : `Update the default in src/jobs/processor.ts.`)
  );
}

export async function runDefaultModelSelfCheck(
  deps: { settingsRepo?: SettingsRepo; settingsCache?: SettingsCache } = {},
): Promise<StaleModelWarning[]> {
  const explainer = await resolveSetting("model.explainer", DEFAULT_EXPLAINER_MODEL, deps.settingsRepo, deps.settingsCache);
  const verifier = await resolveSetting("model.verifier", DEFAULT_VERIFIER_MODEL, deps.settingsRepo, deps.settingsCache);

  const resolutions: ModelUsageResolution[] = [
    { settingKey: "model.explainer", role: "EXPLAINER", source: explainer.source, modelId: explainer.value },
    { settingKey: "model.verifier", role: "VERIFIER", source: verifier.source, modelId: verifier.value },
  ];

  const models = await provider.listModels();
  const catalogIds = new Set(models.map((m) => m.id));
  const stale = findStaleModels(resolutions, catalogIds);
  for (const w of stale) console.error(formatStaleWarning(w));
  if (stale.length === 0) {
    console.log(`[self-check] model defaults OK (${resolutions.map((r) => `${r.role}:${r.modelId}`).join(", ")})`);
  }
  return stale;
}
