/**
 * Minimal RFC4180 CSV parser — no dependency, because the 69-B list has fields that
 * genuinely need it: razón social values contain embedded commas inside quotes
 * (e.g. `"ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V."`), which a naive
 * line.split(',') silently mis-parses (confirmed empirically against the real file —
 * it leaks fragments of quoted fields as if they were their own columns). Processes
 * the whole text as one character stream rather than splitting into lines first, so a
 * raw newline inside a quoted field (should one ever appear) can't break row boundaries.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
