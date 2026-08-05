/**
 * The SAT publishes no rate limit for ConsultaCFDIService but is documented to block
 * abusive callers — see CLAUDE.md. Since this check is the product's actual
 * differentiator, getting throttled mid-batch isn't an edge case to handle later,
 * it's a correctness requirement from day one. This paces requests *before* sending
 * (a fixed minimum interval between calls), rather than firing freely and reacting
 * to 429s after the fact — the same policy job-search-agents/CLAUDE.md documents for
 * NIM, applied here because the same "no published limit, but it bites" shape holds.
 */
export class RateLimiter {
  private nextAvailableAt = 0;
  private readonly minIntervalMs: number;

  // Plain assignment, not a TS constructor parameter property: `node
  // --experimental-strip-types` only strips type annotations, it doesn't transform
  // syntax that generates code (parameter properties, enums, namespaces) — see
  // CLAUDE.md if this surfaces again elsewhere.
  constructor(minIntervalMs: number) {
    this.minIntervalMs = minIntervalMs;
  }

  /** Resolves once it's this caller's turn. Callers must await it before each request. */
  async wait(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAvailableAt - now);
    this.nextAvailableAt = Math.max(now, this.nextAvailableAt) + this.minIntervalMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

/**
 * Exponential backoff: baseDelayMs, 2x, 4x, ... up to maxRetries attempts total.
 * Retries on any thrown error (network failure, timeout, non-2xx) — the caller's `fn`
 * is responsible for turning a bad HTTP status into a thrown error if it should be
 * retried at all (a well-formed "No Encontrado" SOAP response is not an error and
 * must not reach this function as one).
 */
export async function withBackoff<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
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
