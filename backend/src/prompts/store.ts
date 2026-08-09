// Business logic on top of prompts/repo.ts. activatePromptVersion is what actually closes
// cv-tailor's own regression-test gap (see structuralChecks.ts's header comment): its
// tailorPrompt.test.js can only ever see the in-code FALLBACK_SETTINGS, never whatever an
// admin has stored in the DB at runtime. Here, assertPromptStructurallySafe runs as a
// RUNTIME GUARD on activation -- the exact same check the test suite runs against the
// in-code fallback -- so a structurally-unsafe prompt can never become the live one.
import { prismaPromptVersionRepo, type PromptVersionRepo, type PromptVersionRecord } from "./repo.ts";
import { assertPromptStructurallySafe } from "./structuralChecks.ts";

export class PromptVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`PromptVersion "${id}" not found.`);
    this.name = "PromptVersionNotFoundError";
  }
}

export class ActivePromptDeletionError extends Error {
  constructor(id: string) {
    super(
      `PromptVersion "${id}" is currently active and cannot be deleted -- activate a ` +
        "different version for its key first.",
    );
    this.name = "ActivePromptDeletionError";
  }
}

export interface PromptResolution {
  body: string;
  source: "stored" | "fallback";
  versionId: string | null;
  version: number | null;
}

/** Prompt-source-agnostic resolution, called from jobs/processor.ts. Falls back to the
 *  in-code constant (explainer.ts's EXPLAINER_SYSTEM_PROMPT / verifier.ts's
 *  VERIFIER_SYSTEM_PROMPT) whenever no PromptVersion has been activated for `key` yet --
 *  a fresh install with an empty PromptVersion table behaves identically to before this
 *  sub-phase existed. Mirrors settings/resolver.ts's SettingResolution<T> shape
 *  deliberately (never a bare value, always carries where it came from), same discipline
 *  applied to a second kind of admin-overridable config. */
export async function resolveActivePromptBody(
  key: string,
  fallback: string,
  repo: PromptVersionRepo = prismaPromptVersionRepo,
): Promise<PromptResolution> {
  const active = await repo.findActive(key);
  return active
    ? { body: active.body, source: "stored", versionId: active.id, version: active.version }
    : { body: fallback, source: "fallback", versionId: null, version: null };
}

export async function listPromptVersions(
  key: string,
  repo: PromptVersionRepo = prismaPromptVersionRepo,
): Promise<PromptVersionRecord[]> {
  return repo.listByKey(key);
}

/** Deliberately does NOT run assertPromptStructurallySafe -- an admin must be able to save
 *  an in-progress draft that doesn't pass yet and iterate on it before activating. The
 *  guard belongs on activation (below), matching the Phase 5 plan's own framing: "an admin
 *  cannot ACTIVATE a prompt whose body fails the checks," not "cannot save a draft." */
export async function createPromptVersion(
  key: string,
  body: string,
  createdBy: string | null,
  repo: PromptVersionRepo = prismaPromptVersionRepo,
): Promise<PromptVersionRecord> {
  return repo.create(key, body, createdBy);
}

/** Runtime guard: an admin cannot activate a prompt whose body fails the exact same
 *  structural checks explainerPrompt.test.ts runs against the in-code fallback. Throws
 *  PromptStructureError (not a boolean) on failure -- same "never return an ignorable
 *  boolean" discipline structuralChecks.ts itself follows. */
export async function activatePromptVersion(
  id: string,
  repo: PromptVersionRepo = prismaPromptVersionRepo,
): Promise<PromptVersionRecord> {
  const target = await repo.findById(id);
  if (!target) throw new PromptVersionNotFoundError(id);

  assertPromptStructurallySafe(target.body);

  await repo.activate(target.key, id);
  const activated = await repo.findById(id);
  // Can't be null -- this function just activated this exact row and nothing else here
  // deletes it. A non-null assertion made explicit, not one silently swallowed elsewhere.
  return activated!;
}

export async function deletePromptVersion(
  id: string,
  repo: PromptVersionRepo = prismaPromptVersionRepo,
): Promise<void> {
  const target = await repo.findById(id);
  if (!target) throw new PromptVersionNotFoundError(id);
  if (target.active) throw new ActivePromptDeletionError(id);
  await repo.remove(id);
}
