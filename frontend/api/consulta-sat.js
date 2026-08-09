// ../sat-client/src/rateLimiter.ts
var RateLimiter = class {
  nextAvailableAt = 0;
  minIntervalMs;
  // Plain assignment, not a TS constructor parameter property: `node
  // --experimental-strip-types` only strips type annotations, it doesn't transform
  // syntax that generates code (parameter properties, enums, namespaces) — see
  // CLAUDE.md if this surfaces again elsewhere.
  constructor(minIntervalMs) {
    this.minIntervalMs = minIntervalMs;
  }
  /** Resolves once it's this caller's turn. Callers must await it before each request. */
  async wait() {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
};
async function withBackoff(fn, opts) {
  let lastError;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.maxRetries) break;
      const delay = opts.baseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// ../sat-client/src/consultaCfdi.ts
var ENDPOINT = "https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc";
var SOAP_ACTION = "http://tempuri.org/IConsultaCFDIService/Consulta";
var EFOS_EMISOR_ENCONTRADO_CODES = /* @__PURE__ */ new Set(["100", "101", "104"]);
var EFOS_EMISOR_NO_ENCONTRADO_CODES = /* @__PURE__ */ new Set(["102", "103", "200", "201"]);
function buildExpresionImpresa({ rfcEmisor, rfcReceptor, total, uuid }) {
  return `?re=${rfcEmisor}&rr=${rfcReceptor}&tt=${total}&id=${uuid}`;
}
function buildSoapEnvelope(expresionImpresa) {
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
function parseSoapResponse(xml) {
  const field = (name) => {
    const match = xml.match(new RegExp(`<a:${name}[^>]*>([^<]*)</a:${name}>`));
    return match ? match[1] : "";
  };
  return {
    codigoEstatus: field("CodigoEstatus"),
    esCancelable: field("EsCancelable"),
    estado: field("Estado"),
    estatusCancelacion: field("EstatusCancelacion"),
    validacionEfos: field("ValidacionEFOS")
  };
}
function interpretEfosEmisorEncontrado(validacionEfos) {
  if (EFOS_EMISOR_ENCONTRADO_CODES.has(validacionEfos)) return true;
  if (EFOS_EMISOR_NO_ENCONTRADO_CODES.has(validacionEfos)) return false;
  return null;
}
function interpret(raw) {
  const found = raw.estado !== "No Encontrado" && raw.estado !== "";
  const vigente = !found ? null : raw.estado === "Vigente" ? true : raw.estado === "Cancelado" ? false : null;
  const cancelado = vigente === null ? null : !vigente;
  const efosEmisorEncontrado = interpretEfosEmisorEncontrado(raw.validacionEfos);
  return { raw, found, vigente, cancelado, efosEmisorEncontrado };
}
var ConsultaCfdiClient = class {
  limiter;
  timeoutMs;
  retry;
  constructor(opts = {}) {
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 1e3);
    this.timeoutMs = opts.timeoutMs ?? 45e3;
    this.retry = opts.retry ?? { maxRetries: 3, baseDelayMs: 2e3 };
  }
  /** One UUID, paced and retried. Never throws on a well-formed "No Encontrado" — only
   *  on network failure, timeout, or a malformed response after exhausting retries. */
  async consulta(params) {
    return withBackoff(async () => {
      await this.limiter.wait();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            SOAPAction: SOAP_ACTION
          },
          body: buildSoapEnvelope(buildExpresionImpresa(params)),
          signal: controller.signal
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
  async consultaBatch(items, onResult) {
    for (const params of items) {
      try {
        const result = await this.consulta(params);
        onResult(params, result);
      } catch (err) {
        onResult(params, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
};

// api-src/consulta-sat.ts
var config = { runtime: "nodejs" };
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function parseConsultaCfdiParams(body) {
  if (typeof body !== "object" || body === null) return null;
  const { rfcEmisor, rfcReceptor, total, uuid } = body;
  if (![rfcEmisor, rfcReceptor, total, uuid].every(isNonEmptyString)) return null;
  return { rfcEmisor, rfcReceptor, total, uuid };
}
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*"
    }
  });
}
async function handleConsultaSatRequest(request, consultaFn) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type"
      }
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed \u2014 use POST" }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const params = parseConsultaCfdiParams(body);
  if (!params) {
    return jsonResponse(
      { error: "Request body must include non-empty rfcEmisor, rfcReceptor, total, and uuid" },
      400
    );
  }
  try {
    const result = await consultaFn(params);
    return jsonResponse(result, 200);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      502
    );
  }
}
var client = new ConsultaCfdiClient();
function handler(request) {
  return handleConsultaSatRequest(request, (params) => client.consulta(params));
}
export {
  config,
  handler as default,
  handleConsultaSatRequest,
  parseConsultaCfdiParams
};
//# sourceMappingURL=consulta-sat.js.map
