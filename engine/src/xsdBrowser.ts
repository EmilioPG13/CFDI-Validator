import { XmlDocument, XsdValidator, xmlRegisterInputProvider } from "libxml2-wasm";
import { XmlBufferInputProvider } from "libxml2-wasm/lib/utils.mjs";

/**
 * Browser-side counterpart to xsd.ts's `loadCfdi40Validator`/`loadCfdiValidatorWithComplements`
 * — same libxml2-wasm core (`XmlDocument`, `XsdValidator`), different I/O boundary. xsd.ts
 * registers `xmlRegisterFsInputProviders()` from `libxml2-wasm/lib/nodejs.mjs`, a Node-only
 * subpath backed by `node:fs` (CLAUDE.md's own gotcha on this). This file instead registers
 * `XmlBufferInputProvider` (from the package's main, environment-agnostic entrypoint —
 * exported alongside the generic `xmlRegisterInputProvider`, not the Node subpath) over an
 * in-memory `Record<string, Uint8Array>`. Confirmed working end-to-end this session (a
 * throwaway spike compiled cfdv40.xsd, the TimbreFiscalDigital complement wrapper, AND
 * validated a real fixture — all three, through this exact mechanism, before writing this
 * file) — not assumed from reading the type definitions alone.
 *
 * Key format matters and is NOT free-form: `XmlBufferInputProvider.match()` does an exact
 * string lookup (`this._data[filename] != null` — read directly from
 * libxml2-wasm/lib/utils.mjs, not guessed), and libxml2's own C-level URI-resolution logic
 * (which runs *before* any registered provider is consulted) resolves a relative
 * `schemaLocation` against the importing document's base `url` using standard relative-URL
 * rules — the same behavior as a browser resolving a relative link. So a document loaded
 * with `url: "file:///cfd/4/cfdv40.xsd"` whose schema says
 * `schemaLocation="../catalogos/catCFDI.xsd"` will ask the provider for exactly
 * `"file:///cfd/catalogos/catCFDI.xsd"` — the buffer map's keys MUST be built the same way,
 * mirroring corpus/xsd/'s own directory layout under a synthetic `file:///` base (nothing
 * real is read from disk; `file:///` is just a base scheme relative-URL resolution needs,
 * not an actual filesystem access — see CLAUDE.md's "don't flatten corpus/xsd/" gotcha,
 * which applies here identically, just to in-memory keys instead of real folders).
 */
const VIRTUAL_BASE = "file:///";

/**
 * The exact set of files this project's XSD tree needs, as paths relative to
 * `corpus/xsd/` — see corpus/README.md for why this exact layout (mirrors the SAT's own
 * `sitio_internet/cfd/...` structure so `schemaLocation`s resolve without rewriting).
 * A caller (the frontend's asset-loading code, not this file — engine/ stays free of
 * fetch/DOM code by design) fetches these same relative paths and passes the bytes in.
 */
export const XSD_TREE_FILES = [
  "cfd/4/cfdv40.xsd",
  "cfd/catalogos/catCFDI.xsd",
  "cfd/tipoDatos/tdCFDI/tdCFDI.xsd",
  "cfd/TimbreFiscalDigital/TimbreFiscalDigitalv11.xsd",
] as const;

/** Bytes for every file in `XSD_TREE_FILES`, keyed by that same relative path. */
export type XsdTreeBuffers = Record<(typeof XSD_TREE_FILES)[number], Uint8Array>;

function virtualUrl(relativePath: string): string {
  return VIRTUAL_BASE + relativePath;
}

/**
 * Registers the given XSD tree bytes as a buffer-backed input provider so libxml2's
 * `xsd:import`/`xsd:include` resolution can find them without real disk/network access.
 *
 * One-time per buffer set, same idempotent-registration spirit as
 * `xmlRegisterFsInputProviders()` in xsd.ts — but unlike that Node function (which is
 * stateless, just flips on real fs access), this one is genuinely stateful: it captures
 * the SPECIFIC buffers passed in. Calling it twice with different buffers registers a
 * second provider rather than replacing the first (libxml2-wasm's own
 * `xmlRegisterInputProvider` API, not this file's choice) — call `xmlCleanupInputProvider()`
 * (re-exported below) first if that's ever a problem, e.g. between isolated test cases.
 */
export function registerXsdTreeBuffers(buffers: XsdTreeBuffers): void {
  const keyed: Record<string, Uint8Array> = {};
  for (const relPath of XSD_TREE_FILES) {
    keyed[virtualUrl(relPath)] = buffers[relPath];
  }
  xmlRegisterInputProvider(new XmlBufferInputProvider(keyed));
}

/** Re-exported so callers (tests, or the frontend between page loads) can reset provider
 *  state without reaching into libxml2-wasm's own module path directly. */
export { xmlCleanupInputProvider } from "libxml2-wasm";

/**
 * Compiles a validator for the base CFDI 4.0 schema alone, from buffers already
 * registered via `registerXsdTreeBuffers` — mirrors xsd.ts's `loadCfdi40Validator`, but
 * reads the root schema's bytes from the same buffer map instead of `readFileSync`. See
 * that function's own doc comment (xsd.ts) for why this alone can never validate a real,
 * TimbreFiscalDigital-bearing CFDI — use `loadCfdiValidatorWithComplementsBrowser` for
 * anything that touches real documents, same rule as the Node side.
 *
 * Must be called after `registerXsdTreeBuffers` with the same buffers, or compilation
 * fails the same way xsd.ts's version fails on a missing/unresolvable import — at
 * compile time, not lazily during validation.
 */
export function loadCfdi40ValidatorBrowser(rootSchemaBytes: Uint8Array): XsdValidator {
  const url = virtualUrl("cfd/4/cfdv40.xsd");
  const schemaDoc = XmlDocument.fromBuffer(rootSchemaBytes, { url });
  try {
    return XsdValidator.fromDoc(schemaDoc);
  } finally {
    schemaDoc.dispose();
  }
}

export interface BrowserComplementSchema {
  /** The complement's XSD target namespace — same meaning as xsd.ts's `ComplementSchema.namespace`. */
  namespace: string;
  /** Path relative to corpus/xsd/, matching one of `XSD_TREE_FILES` — NOT an arbitrary
   *  path; must have been included in the buffers passed to `registerXsdTreeBuffers`. */
  relativePath: string;
}

/**
 * Browser counterpart to xsd.ts's `loadCfdiValidatorWithComplements` — same synthetic
 * wrapper-schema trick (a `<xs:schema>` that `xs:import`s the base CFDI schema plus each
 * given complement side by side, all via the same virtual `file:///` URLs
 * `registerXsdTreeBuffers` already registered), same compile-time-failure behavior.
 *
 * `rootSchemaPath`/complement `path`s in xsd.ts become `relativePath`s here, resolved to
 * the matching virtual URL — the wrapper schema's own imports must point at exactly what
 * the registered `XmlBufferInputProvider` will recognize.
 */
export function loadCfdiValidatorWithComplementsBrowser(
  complements: BrowserComplementSchema[],
  rootSchemaBytes: Uint8Array,
): XsdValidator {
  if (complements.length === 0) {
    return loadCfdi40ValidatorBrowser(rootSchemaBytes);
  }

  const imports = [
    `<xs:import namespace="http://www.sat.gob.mx/cfd/4" schemaLocation="${virtualUrl("cfd/4/cfdv40.xsd")}"/>`,
    ...complements.map(
      (c) => `<xs:import namespace="${c.namespace}" schemaLocation="${virtualUrl(c.relativePath)}"/>`,
    ),
  ].join("\n  ");
  const wrapperXml = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  ${imports}\n</xs:schema>`;

  // NOT Buffer.from — Buffer is a Node global, doesn't exist in a browser bundle unless
  // polyfilled (Vite doesn't, by default). TextEncoder is the Web-standard equivalent and
  // is also available in Node, so this line alone would work in either environment — but
  // this whole module only exists for the browser side, so use the portable one throughout
  // rather than relying on that coincidence.
  const schemaDoc = XmlDocument.fromBuffer(new TextEncoder().encode(wrapperXml));
  try {
    return XsdValidator.fromDoc(schemaDoc);
  } finally {
    schemaDoc.dispose();
  }
}

export interface XsdValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Browser counterpart to xsd.ts's `validateXml` — same logic (validate bytes against an
 * already-compiled validator, never throw), but NOT re-exported from xsd.ts: that module
 * imports `node:fs` and the Node-only `libxml2-wasm/lib/nodejs.mjs` subpath at its own
 * top level (including a module-load-time side effect, `xmlRegisterFsInputProviders()`),
 * so importing anything from it — even just a function that happens not to touch fs —
 * would drag those Node-only imports into a browser bundle. Also swaps `Buffer | string`
 * for `Uint8Array | string` and `Buffer.from(xml, "utf-8")` for `TextEncoder`, same
 * portability reasoning as `loadCfdiValidatorWithComplementsBrowser` above — `Buffer`
 * plain doesn't exist in a browser.
 */
export function validateXmlBrowser(
  validator: XsdValidator,
  xml: Uint8Array | string,
  sourceUrl?: string,
): XsdValidationResult {
  const bytes = typeof xml === "string" ? new TextEncoder().encode(xml) : xml;
  const doc = XmlDocument.fromBuffer(bytes, sourceUrl ? { url: sourceUrl } : undefined);
  try {
    validator.validate(doc);
    return { valid: true, errors: [] };
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  } finally {
    doc.dispose();
  }
}
