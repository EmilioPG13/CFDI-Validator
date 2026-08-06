import { RateLimiter, withBackoff, type RetryOptions } from "./rateLimiter.ts";

// Confirmed directly against the live WSDL and a real request/response round-trip
// (not from secondhand docs — the SAT's own PDF for this service is a scanned image,
// not machine-readable text) on 2026-08-04:
//   WSDL:     https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?wsdl
//   Request:  a single string param `expresionImpresa` — the same "?re=...&rr=...&tt=...&id=..."
//             query string printed as a QR code on every CFDI.
//   Response: `Acuse` { CodigoEstatus, EsCancelable, Estado, EstatusCancelacion, ValidacionEFOS },
//             all plain strings, none formally enumerated by SAT. A garbage UUID
//             (00000000-0000-0000-0000-000000000000) returned Estado="No Encontrado" with
//             every other field empty — confirmed live, not assumed.
//
// ValidacionEFOS semantics — closed 2026-08-05 against the SAT's OWN official PDF (this
// one *is* machine-readable text, unlike the scanned doc above), retrieved over plain HTTP
// per this project's known omawww.sat.gob.mx TLS gotcha (see CLAUDE.md):
//   "Documentación del Servicio de Consulta de CFDI", Versión 1.4, Fecha: Noviembre 2022,
//   http://omawww.sat.gob.mx/tramitesyservicios/Paginas/documentos/Documentacion_WS_Consulta_CFDI_v1.4.pdf,
//   sección 3 "Mensajes de Respuesta" > "Mensajes de validación del RFC Emisor" (p. 10-15,
//   corrected from an initial 10-14 estimate — confirmed by physical page count via
//   pdftotext's own form-feed page breaks, código=201 spills onto p. 15),
//   text extracted with `pdftotext -layout`, not paraphrased from a third-party blog.
// ValidacionEFOS carries one of these numeric codes as a string:
//   100, 101, 104 — "la validación del RFC Emisor del CFDI SE ENCUENTRE dentro de la lista
//                    de Empresa que Factura Operaciones Simuladas (EFOS)" — and the
//                    per-code message text explicitly ties this to "el listado de
//                    definitivas", i.e. the SAME "Definitivo" tier (Art. 69-B, párrafos
//                    primero al quinto) that emisor-efos-69b's static CSV check already
//                    treats as severity 'error' — this is that same legal fact, fetched
//                    live per query instead of from a CSV snapshot.
//   102, 103, 200, 201 — RFC Emisor NOT found on that list ("no se encuentre dentro de
//                    la lista"). 200/201 are the plain case; 102/103 both still say the
//                    Emisor specifically was NOT found (only a "cuenta de terceros" RFC
//                    was, which this project doesn't parse from CFDI XML and is out of
//                    scope) — grouped with 200/201 for that reason.
//   anything else (including "", the No-Encontrado case) — unrecognized/absent, treated
//                    as "don't know", same nullable philosophy as `vigente`/`cancelado`
//                    below, not smoothed into a false negative.
// Known gap, not resolved by this doc: SAT's own PDF text describes WHICH list (the
// "definitivas" one) but not WHEN it's evaluated against — at CFDI issuance, at the time
// SAT received the CFDI, or at the moment of this live query. Third-party client libraries
// (phpcfdi/cfdiutils, nodecfdi/sat-estado-cfdi) flag the exact same open question
// independently, which is corroborating, not resolving — treat this field as "Emisor RFC
// is on the Definitivo EFOS list as of right now, at query time" (the only reading
// consistent with it being a live, stateless service call), not as a historical fact about
// the invoice's issuance date.
const ENDPOINT = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";

/** Codes confirmed by the SAT's own PDF (see header comment) to mean "RFC Emisor IS on
 *  the EFOS Definitivo list" vs "is NOT" — every other value (including "") is unknown. */
const EFOS_EMISOR_ENCONTRADO_CODES = new Set(["100", "101", "104"]);
const EFOS_EMISOR_NO_ENCONTRADO_CODES = new Set(["102", "103", "200", "201"]);

export interface ConsultaCfdiParams {
  rfcEmisor: string;
  rfcReceptor: string;
  total: string;
  uuid: string;
}

/** The raw, unmodified strings SAT returns — kept as Finding evidence, never discarded. */
export interface ConsultaCfdiRaw {
  codigoEstatus: string;
  esCancelable: string;
  estado: string;
  estatusCancelacion: string;
  validacionEfos: string;
}

export interface ConsultaCfdiResult {
  raw: ConsultaCfdiRaw;
  /** false only when Estado is exactly "No Encontrado" — SAT has no record of this UUID at all. */
  found: boolean;
  /**
   * Interpreted from `raw.estado`. Deliberately nullable rather than defaulting to
   * false: SAT's field values aren't a closed, formally-published enum (only observed
   * + documented by third parties), so an unrecognized string must surface as "don't
   * know" — silently treating an unexpected value as "not cancelled" would be exactly
   * the kind of confident-but-wrong claim this project exists to avoid making.
   */
  vigente: boolean | null;
  cancelado: boolean | null;
  /**
   * Interpreted from `raw.validacionEfos` (see this file's header comment for the code
   * table and its citation) — true when the Emisor RFC is, right now, on the SAT's own
   * "Definitivo" EFOS list (Art. 69-B, párrafos primero-quinto CFF); false when SAT's
   * live check says it's not; null when the code is unrecognized or absent (e.g. the
   * UUID wasn't found at all) — same "don't know" philosophy as `vigente`/`cancelado`,
   * not defaulted to a false negative.
   */
  efosEmisorEncontrado: boolean | null;
}

function buildExpresionImpresa({ rfcEmisor, rfcReceptor, total, uuid }: ConsultaCfdiParams): string {
  return `?re=${rfcEmisor}&rr=${rfcReceptor}&tt=${total}&id=${uuid}`;
}

function buildSoapEnvelope(expresionImpresa: string): string {
  // expresionImpresa is XML-escaped, not treated as trusted markup — it's built from
  // fields taken off an uploaded CFDI, which is untrusted input.
  const escaped = expresionImpresa.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soap:Header/>
  <soap:Body>
    <tem:Consulta>
      <tem:expresionImpresa>${escaped}</tem:expresionImpresa>
    </tem:Consulta>
  </soap:Body>
</soap:Envelope>`;
}

function parseSoapResponse(xml: string): ConsultaCfdiRaw {
  // Deliberately not a full XML parser — one flat, known, non-recursive shape (all
  // fields are direct children of <ConsultaResult>, no nesting, no attributes to
  // confuse a naive regex). Swapping to libxml2-wasm here would mean spinning up a
  // WASM XmlDocument per network call for no accuracy gain on a shape this simple.
  const field = (name: string): string => {
    const match = xml.match(new RegExp(`<a:${name}[^>]*>([^<]*)</a:${name}>`));
    return match ? match[1] : "";
  };
  return {
    codigoEstatus: field("CodigoEstatus"),
    esCancelable: field("EsCancelable"),
    estado: field("Estado"),
    estatusCancelacion: field("EstatusCancelacion"),
    validacionEfos: field("ValidacionEFOS"),
  };
}

/** Exported for direct unit testing against the full documented code table (see this
 *  file's header comment) without needing a live network round-trip for every case —
 *  the live test can only exercise the "" / not-found branch deterministically. */
export function interpretEfosEmisorEncontrado(validacionEfos: string): boolean | null {
  if (EFOS_EMISOR_ENCONTRADO_CODES.has(validacionEfos)) return true;
  if (EFOS_EMISOR_NO_ENCONTRADO_CODES.has(validacionEfos)) return false;
  return null;
}

function interpret(raw: ConsultaCfdiRaw): ConsultaCfdiResult {
  const found = raw.estado !== "No Encontrado" && raw.estado !== "";
  const vigente = !found ? null : raw.estado === "Vigente" ? true : raw.estado === "Cancelado" ? false : null;
  const cancelado = vigente === null ? null : !vigente;
  const efosEmisorEncontrado = interpretEfosEmisorEncontrado(raw.validacionEfos);
  return { raw, found, vigente, cancelado, efosEmisorEncontrado };
}

export interface ConsultaCfdiClientOptions {
  /** Minimum ms between requests. SAT publishes no limit; default is deliberately conservative. */
  minIntervalMs?: number;
  timeoutMs?: number;
  retry?: RetryOptions;
}

export class ConsultaCfdiClient {
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions;

  constructor(opts: ConsultaCfdiClientOptions = {}) {
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 1000);
    this.timeoutMs = opts.timeoutMs ?? 45_000; // SAT is documented to be slow at peak hours
    this.retry = opts.retry ?? { maxRetries: 3, baseDelayMs: 2000 };
  }

  /** One UUID, paced and retried. Never throws on a well-formed "No Encontrado" — only
   *  on network failure, timeout, or a malformed response after exhausting retries. */
  async consulta(params: ConsultaCfdiParams): Promise<ConsultaCfdiResult> {
    return withBackoff(async () => {
      await this.limiter.wait();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: SOAP_ACTION,
          },
          body: buildSoapEnvelope(buildExpresionImpresa(params)),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`ConsultaCFDIService HTTP ${response.status}`);
        }
        const xml = await response.text();
        return interpret(parseSoapResponse(xml));
      } finally {
        clearTimeout(timeout);
      }
    }, this.retry);
  }

  /**
   * Sequential batch (the rate limiter already serializes real send timing; running
   * these concurrently would just mean N requests racing to await the same limiter).
   * `onResult` fires after each item — the checkpointing hook: a caller persists here
   * so an interrupted batch resumes instead of restarting. A single UUID's failure
   * (after its own retries) doesn't abort the batch; it's reported per-item.
   */
  async consultaBatch(
    items: ConsultaCfdiParams[],
    onResult: (params: ConsultaCfdiParams, result: ConsultaCfdiResult | { error: string }) => void,
  ): Promise<void> {
    for (const params of items) {
      try {
        const result = await this.consulta(params);
        onResult(params, result);
      } catch (err) {
        onResult(params, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
