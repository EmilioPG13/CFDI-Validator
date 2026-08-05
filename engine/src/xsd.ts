import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { XmlDocument, XsdValidator } from "libxml2-wasm";
import { xmlRegisterFsInputProviders } from "libxml2-wasm/lib/nodejs.mjs";

// libxml2-wasm runs libxml2 compiled to WASM, which by default only sees an
// in-memory virtual filesystem — a `url` alone gives it a base to resolve
// *relative paths* against, but doesn't grant it real disk access. Registering
// the Node fs-backed input provider is what makes `xsd:import`/`xsd:include`
// schemaLocation resolution actually read from disk. One-time, module-level,
// safe to call more than once (the underlying call is idempotent).
xmlRegisterFsInputProviders();

/**
 * Loads the CFDI 4.0 XSD tree from a real filesystem path and compiles a validator.
 *
 * The `url` passed to `XmlDocument.fromBuffer` is what libxml2 resolves relative
 * `schemaLocation` paths (xsd:import / xsd:include) against — without it, the root
 * schema has no base to resolve `../catalogos/catCFDI.xsd` etc. from, and compilation
 * fails. Must be a real, absolute, on-disk path matching the corpus/xsd/ layout
 * documented in corpus/README.md — flattening that layout breaks this.
 *
 * Throws if any import in the tree fails to resolve — that failure surfaces here,
 * at compile time, not lazily when validating a document.
 */
export function loadCfdi40Validator(schemaPath: string): XsdValidator {
  const buf = readFileSync(schemaPath);
  const schemaDoc = XmlDocument.fromBuffer(buf, {
    url: pathToFileURL(schemaPath).href,
  });
  try {
    return XsdValidator.fromDoc(schemaDoc);
  } finally {
    // XsdValidator.fromDoc compiles its own internal representation; the source
    // XmlDocument isn't needed after that, per the libxml2-wasm docs' own example.
    schemaDoc.dispose();
  }
}

export interface ComplementSchema {
  /** The complement's XSD target namespace, e.g. "http://www.sat.gob.mx/TimbreFiscalDigital". */
  namespace: string;
  /** Absolute on-disk path to that complement's .xsd. */
  path: string;
}

/**
 * A CFDI 4.0 `Comprobante` declares its `Complemento` child as an `xs:any` wildcard,
 * and the XSD spec's default for an unmarked wildcard is `processContents="strict"`
 * — meaning a validator must have the complement's own global element declaration
 * loaded to accept it *at all*. `cfdv40.xsd` does not import complement schemas
 * (complements are pluggable by design: TimbreFiscalDigital, Pagos, Comercio
 * Exterior, Nómina... are independent, optional XSDs). Concretely: every real CFDI
 * downloaded from the SAT portal carries a TimbreFiscalDigital complement, so
 * `loadCfdi40Validator` alone can never validate one — it isn't a fixture-only
 * problem, it's every document this product will ever be asked to check.
 *
 * This compiles a synthetic wrapper schema that `xs:import`s the base CFDI schema
 * plus each given complement side by side (all via absolute `file://` URLs, so the
 * wrapper's own on-disk location — it doesn't have one, it's never written to
 * disk — is irrelevant to how its imports resolve). Same underlying compile-time
 * failure behavior as `loadCfdi40Validator`: an unresolvable complement path throws
 * here, not lazily during validation.
 */
export function loadCfdiValidatorWithComplements(
  baseSchemaPath: string,
  complements: ComplementSchema[],
): XsdValidator {
  if (complements.length === 0) {
    return loadCfdi40Validator(baseSchemaPath);
  }

  const imports = [
    `<xs:import namespace="http://www.sat.gob.mx/cfd/4" schemaLocation="${pathToFileURL(baseSchemaPath).href}"/>`,
    ...complements.map(
      (c) => `<xs:import namespace="${c.namespace}" schemaLocation="${pathToFileURL(c.path).href}"/>`,
    ),
  ].join("\n  ");
  const wrapperXml = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  ${imports}\n</xs:schema>`;

  const schemaDoc = XmlDocument.fromBuffer(Buffer.from(wrapperXml, "utf-8"));
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

/** Validates raw XML bytes against an already-compiled validator. Never throws. */
export function validateXml(
  validator: XsdValidator,
  xml: Buffer | string,
  sourceUrl?: string,
): XsdValidationResult {
  const doc = XmlDocument.fromBuffer(
    typeof xml === "string" ? Buffer.from(xml, "utf-8") : xml,
    sourceUrl ? { url: sourceUrl } : undefined,
  );
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
