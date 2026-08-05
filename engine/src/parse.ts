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

export interface ParsedCfdiTimbreFiscalDigital {
  UUID: string;
}

export interface ParsedCfdiComplemento {
  TimbreFiscalDigital?: ParsedCfdiTimbreFiscalDigital;
}

export interface ParsedCfdiConcepto {
  ClaveProdServ: string;
  ClaveUnidad: string;
  /** Amounts are XML attribute strings, not numbers — see engine/src/decimal.ts for
   *  why comparing them requires decimalEquals/sumDecimal, never native === or +. */
  Importe: string;
  Descuento?: string;
}

export interface ParsedCfdiConceptos {
  /** @nodecfdi/cfdi-to-json returns repeatable elements as arrays even with one item
   *  (verified empirically — see this file's other doc comments); Concepto is always
   *  present at least once (Conceptos is a required, non-empty node per the XSD). */
  Concepto: ParsedCfdiConcepto[];
}

export interface ParsedCfdiTraslado {
  /** Optional per the XSD: a Traslado with TipoFactor="Exento" has no Importe — see
   *  the impuestos-totales-consistencia rule spec for why this must be treated as 0
   *  in a sum, not as missing/invalid data. */
  Importe?: string;
}

export interface ParsedCfdiRetencion {
  /** Required per the XSD — unlike Traslado, every Retencion always has an Importe. */
  Importe: string;
}

export interface ParsedCfdiImpuestos {
  TotalImpuestosTrasladados?: string;
  TotalImpuestosRetenidos?: string;
  Traslados?: { Traslado: ParsedCfdiTraslado[] };
  Retenciones?: { Retencion: ParsedCfdiRetencion[] };
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
  /** Optional: a CFDI without any complement is XSD-valid, though every real
   *  SAT-stamped one carries at least TimbreFiscalDigital — see CLAUDE.md. */
  Complemento?: ParsedCfdiComplemento;
  SubTotal: string;
  Total: string;
  Descuento?: string;
  Moneda: string;
  TipoCambio?: string;
  TipoDeComprobante: string;
  Conceptos: ParsedCfdiConceptos;
  /** Comprobante-level Impuestos summary node — optional per the XSD (absent e.g.
   *  for TipoDeComprobante="N", Nómina — see total-comprobante-consistencia's spec). */
  Impuestos?: ParsedCfdiImpuestos;
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
