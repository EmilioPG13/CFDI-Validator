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
const ENDPOINT = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
const SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";

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

function interpret(raw: ConsultaCfdiRaw): ConsultaCfdiResult {
  const found = raw.estado !== "No Encontrado" && raw.estado !== "";
  const vigente = !found ? null : raw.estado === "Vigente" ? true : raw.estado === "Cancelado" ? false : null;
  const cancelado = vigente === null ? null : !vigente;
  return { raw, found, vigente, cancelado };
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
