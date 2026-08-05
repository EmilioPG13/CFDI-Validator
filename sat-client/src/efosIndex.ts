import { parseCsv } from "./csv.ts";

/**
 * The four statuses actually present in the SAT's 69-B file — confirmed by parsing
 * every row of the real corpus/efos/listado_completo_69b.csv, not assumed from docs.
 * "Definitivo" is the one that matters most: per Art. 69-B CFF, once a supplier lands
 * here, invoices they issued produce no tax effect at all, retroactively.
 */
export type EfosSituacion = "Presunto" | "Desvirtuado" | "Definitivo" | "Sentencia Favorable";

export interface EfosRecord {
  rfc: string;
  nombreContribuyente: string;
  situacion: EfosSituacion;
  /** Every other column, keyed by the CSV's own header text — evidence, not discarded. */
  raw: Record<string, string>;
}

export interface EfosIndexMeta {
  /** Parsed from the file's own disclaimer line, e.g. "2025-12-31" — NOT the fetch date.
   *  See corpus/README.md's flagged freshness gap before treating this as "current." */
  informacionActualizadaAl: string | null;
  totalRecords: number;
}

const KNOWN_SITUACIONES = new Set<string>([
  "Presunto",
  "Desvirtuado",
  "Definitivo",
  "Sentencia Favorable",
]);

/**
 * Windows-1252 encoded (confirmed against the real download — UTF-8 decoding it
 * garbles accented characters). Skips the disclaimer line, the title line, and reads
 * column names from the real header row rather than hardcoding column positions, so a
 * SAT column reorder breaks loudly (missing named column) instead of silently
 * misreading data into the wrong field.
 */
export function loadEfosIndex(csvBuffer: Buffer): { records: EfosRecord[]; meta: EfosIndexMeta } {
  const text = new TextDecoder("windows-1252").decode(csvBuffer);
  const rows = parseCsv(text).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));

  const disclaimerMatch = rows[0]?.[0]?.match(/actualizada al (\d{1,2}) de (\w+) de (\d{4})/i);
  const meses: Record<string, string> = {
    enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
    julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
  };
  const informacionActualizadaAl = disclaimerMatch
    ? `${disclaimerMatch[3]}-${meses[disclaimerMatch[2].toLowerCase()] ?? "??"}-${disclaimerMatch[1].padStart(2, "0")}`
    : null;

  const headerRow = rows[2];
  if (!headerRow || headerRow[1] !== "RFC" || headerRow[3] !== "Situación del contribuyente") {
    throw new Error(
      "69-B CSV header row didn't match the expected shape (row index 2, columns RFC/Situación del contribuyente) — SAT may have changed the file's layout. Don't silently reinterpret columns; re-verify against corpus/README.md's fetch notes.",
    );
  }

  const records: EfosRecord[] = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 4 || !row[1]) continue; // skip blank trailing rows

    const situacionRaw = row[3];
    if (!KNOWN_SITUACIONES.has(situacionRaw)) {
      throw new Error(
        `69-B CSV row ${i} has an unrecognized Situación value "${situacionRaw}" — either a parsing bug ` +
          "(check for a CSV-quoting edge case) or SAT added a new status this project doesn't know about yet. Failing loudly rather than silently miscategorizing a supplier's status.",
      );
    }

    const raw: Record<string, string> = {};
    headerRow.forEach((colName, idx) => {
      raw[colName] = row[idx] ?? "";
    });

    records.push({
      rfc: row[1].trim().toUpperCase(),
      nombreContribuyente: row[2],
      situacion: situacionRaw as EfosSituacion,
      raw,
    });
  }

  return { records, meta: { informacionActualizadaAl, totalRecords: records.length } };
}

export class EfosIndex {
  private readonly byRfc = new Map<string, EfosRecord>();
  readonly meta: EfosIndexMeta;

  constructor(csvBuffer: Buffer) {
    const { records, meta } = loadEfosIndex(csvBuffer);
    this.meta = meta;
    for (const record of records) {
      // The file can list the same RFC more than once across its history (e.g.
      // Presunto, later Definitivo). Last row wins — rows appear to be in RFC-sorted,
      // not chronological, order, so "last" here just means "last occurrence in the
      // file"; this is a known simplification worth revisiting if it ever matters
      // (see corpus/README.md for the file's actual column semantics before changing it).
      this.byRfc.set(record.rfc, record);
    }
  }

  lookup(rfc: string): EfosRecord | undefined {
    return this.byRfc.get(rfc.trim().toUpperCase());
  }
}
