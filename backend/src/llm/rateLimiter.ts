// Ported from job-search-agents/src/lib/rateLimit.js (read directly this session, not
// from memory) -- paces requests to stay inside NVIDIA NIM's free-tier limit rather than
// retrying after a 429. The limit is per API key across ALL models and roles (Explainer,
// Verifier, health probes alike), so one shared instance is exported and used everywhere
// a chat-completion call is made -- see rateLimitedProvider.ts.
//
// Waits BEFORE sending rather than retrying after rejection: a single NIM call can take
// 30-170s on the free tier, so retrying a 429 after that means paying the wait twice.
// Slow is not the same as failed here -- the pipeline is throughput-bound, not
// latency-bound.

const WINDOW_MS = 60_000;

export interface RateLimiterStats {
  granted: number;
  averageWaitMs: number;
  longestWaitMs: number;
  limit: number;
}

export class RateLimiter {
  private readonly limit: number;
  /** Start times of requests inside the current window. */
  private recent: number[] = [];
  /** Serializes waiters so they can't all wake and fire at once. */
  private chain: Promise<void> = Promise.resolve();
  private stats = { granted: 0, totalWaitMs: 0, longestWaitMs: 0 };

  constructor(limitPerMinute: number) {
    this.limit = limitPerMinute;
  }

  /** Drop timestamps that have aged out of the window. */
  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.recent.length && this.recent[0] <= cutoff) this.recent.shift();
  }

  /** Resolves when it is safe to send another request. Calls queue behind each other so
   *  concurrent callers are released in order rather than all checking the same stale
   *  count and firing at once. */
  acquire(): Promise<number> {
    const wait = this.chain.then(async () => {
      const started = Date.now();
      for (;;) {
        const now = Date.now();
        this.prune(now);

        if (this.recent.length < this.limit) {
          this.recent.push(now);
          const waited = now - started;
          this.stats.granted++;
          this.stats.totalWaitMs += waited;
          this.stats.longestWaitMs = Math.max(this.stats.longestWaitMs, waited);
          return waited;
        }

        // Sleep until the oldest request leaves the window, plus a little.
        const sleepFor = this.recent[0] + WINDOW_MS - now + 50;
        await new Promise((r) => setTimeout(r, Math.max(sleepFor, 25)));
      }
    });

    // The chain must not break on a rejected caller.
    this.chain = wait.then(
      () => undefined,
      () => undefined,
    );
    return wait;
  }

  /** Requests started in the last minute -- what the limit actually counts. */
  currentRate(): number {
    this.prune(Date.now());
    return this.recent.length;
  }

  report(): RateLimiterStats {
    const { granted, totalWaitMs, longestWaitMs } = this.stats;
    return {
      granted,
      averageWaitMs: granted ? Math.round(totalWaitMs / granted) : 0,
      longestWaitMs,
      limit: this.limit,
    };
  }
}

// One limiter per process, built lazily so importing this module before env.ts has
// validated NIM_RPM_LIMIT doesn't matter -- the default (32, matching job-search-agents'
// own margin below the documented ~40/min cap) applies until env is read.
let _shared: RateLimiter | null = null;

export function getSharedRateLimiter(limitPerMinute = 32): RateLimiter {
  if (!_shared) _shared = new RateLimiter(limitPerMinute);
  return _shared;
}
