/**
 * Decimal-safe comparison for CFDI monetary amounts. Never compare money fields with
 * native `===` on floats — they arrive as strings from XML attributes anyway, and
 * IEEE 754 doubles don't represent most decimal fractions exactly (0.1 + 0.2 !== 0.3).
 *
 * `decimales` should come from `catalogs.db`'s `cfdi_40_monedas.decimales` for the
 * CFDI's declared `Moneda`, via `SatCatalogs.findVigente` — see
 * `engine/rules/registry.json`'s arithmetic rules for why this isn't hardcoded to 2
 * (not every currency the catalog lists uses 2 decimal places).
 *
 * Tolerance: up to 1 unit in the last representable decimal place, not exact equality.
 * This is a deliberate, documented response to a real gap in the source material —
 * Anexo 20's own rounding-methodology FAQ (registry.json's
 * `subtotal-descuento-conceptos-suma` notes, citing FAQ 37/39) says to round once at
 * the end of the calculation but never specifies *which* rounding mode (round-half-up
 * vs. round-half-to-even). A ±1 ULP tolerance absorbs that ambiguity without accepting
 * a genuinely wrong amount — anything off by more than that still fails. This is not
 * "treat centavo differences as fine"; it's covering an unresolved mode question the
 * primary source itself leaves open.
 */
export function decimalEquals(a: string | number, b: string | number, decimales: number): boolean {
  const scale = 10 ** decimales;
  const scaledA = Math.round(Number(a) * scale);
  const scaledB = Math.round(Number(b) * scale);
  return Math.abs(scaledA - scaledB) <= 1;
}

/**
 * Sums with full float precision and rounds only once, at the very end (via the
 * caller's subsequent `decimalEquals` call) — never round individual terms before
 * summing. This mirrors Anexo 20's own stated methodology (FAQ 37/39: "por cada
 * concepto... se puede utilizar... hasta seis decimales... y en los totales se debe
 * redondear al final del cálculo"), not an approximation of it. IEEE 754 double
 * precision is adequate here: realistic invoice amounts are nowhere near the ~2^53
 * safe-integer boundary even scaled to 6 decimal places, so summing a handful of
 * terms as floats introduces error many orders of magnitude smaller than the ±1 ULP
 * comparison tolerance already grants — a full arbitrary-precision decimal library
 * would be solving a precision problem that doesn't actually exist at this scale.
 */
export function sumDecimal(values: readonly (string | number)[]): number {
  return values.reduce((acc: number, v) => acc + Number(v), 0);
}
