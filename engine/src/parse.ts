import { JsonConverter } from "@nodecfdi/cfdi-to-json";

// Verified empirically against a real fixture (attributes become object keys directly,
// repeatable elements like Conceptos.Concepto arrive as arrays even with one item) — the
// package's own type defs don't expose a CFDI-shaped type, only a generic SafeNestedRecord.
export interface ParsedCfdiReceptor {
  Rfc: string;
  Nombre: string;
  DomicilioFiscalReceptor: string;
  RegimenFiscalReceptor: string;
  UsoCFDI: string;
}

export interface ParsedCfdiEmisor {
  Rfc: string;
  Nombre: string;
  RegimenFiscal: string;
}

/**
 * Deliberately partial: only the fields rules have needed so far are typed.
 * Extend as new rules need new fields — don't widen this speculatively ahead
 * of an actual rule that reads the field, or the type stops meaning anything.
 */
export interface ParsedCfdi {
  Version: string;
  Fecha: string;
  Emisor: ParsedCfdiEmisor;
  Receptor: ParsedCfdiReceptor;
  [key: string]: unknown;
}

const converter = new JsonConverter();

export function parseCfdi(xml: string | Buffer): ParsedCfdi {
  const xmlStr = typeof xml === "string" ? xml : xml.toString("utf-8");
  // convertToRecord<T extends SafeNestedRecord>(...): T — SafeNestedRecord isn't exported
  // from the package's public entrypoint, and ParsedCfdi's typed sub-fields (Emisor,
  // Receptor) don't structurally satisfy its index signature anyway. Left uninstantiated,
  // T infers to the constraint itself; the single cast at this boundary is deliberate, not
  // a shortcut — see ParsedCfdi's own doc comment on why it's typed loosely on purpose.
  const record = converter.convertToRecord(xmlStr);
  return record as unknown as ParsedCfdi;
}

/** Comprobante/@Fecha's date portion (YYYY-MM-DD), for vigencia_desde/hasta comparisons. */
export function fechaAsDateOnly(parsed: Pick<ParsedCfdi, "Fecha">): string {
  return parsed.Fecha.slice(0, 10);
}
