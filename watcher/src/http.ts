// Shared fetch helpers for the Catalog Watcher -- zero-dependency on purpose: this
// package runs inside GitHub Actions with nothing but Node 24 and its own files, so
// every capability comes from node: builtins (fetch, crypto, sqlite) plus the one
// bz2 decoder engine/ already standardized on.
import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class FetchError extends Error {
  constructor(url: string, status: number, body: string) {
    super(`GET ${url} failed: HTTP ${status} -- ${body.slice(0, 300)}`);
    this.name = "FetchError";
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_TRIES = 3;

// The SAT hosts in these URLs are flaky by reputation (omawww refuses HTTPS entirely,
// per corpus/README.md) and GitHub's API rate-limits unauthenticated bursts; a small
// bounded retry on network-level failures and 5xx is correctness here, not gold-plating.
// Never retries a 4xx other than 429 -- those are deterministic answers.
export async function fetchBuffer(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; tries?: number } = {},
): Promise<Uint8Array> {
  const { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, tries = DEFAULT_TRIES } = opts;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "cfdi-risk-auditor/catalog-watcher", ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      const body = await res.text().catch(() => "");
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new FetchError(url, res.status, body);
      }
      lastError = new FetchError(url, res.status, body);
    } catch (err) {
      if (err instanceof FetchError && err.message.includes("HTTP 4")) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < tries) {
      // Fixed backoff: two attempts a few seconds apart ride out transient resets
      // without the exponential ceremony a single monthly call doesn't need.
      await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
    }
  }
  throw lastError ?? new Error(`GET ${url} failed after ${tries} attempts`);
}

export async function fetchJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; tries?: number } = {},
): Promise<T> {
  const buf = await fetchBuffer(url, opts);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}
