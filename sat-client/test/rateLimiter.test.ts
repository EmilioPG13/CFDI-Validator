import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, withBackoff } from "../src/rateLimiter.ts";

test("RateLimiter: back-to-back calls are spaced at least minIntervalMs apart", async () => {
  const limiter = new RateLimiter(50);
  const start = Date.now();
  await limiter.wait();
  await limiter.wait();
  await limiter.wait();
  const elapsed = Date.now() - start;
  // 3 calls, 2 gaps of >= 50ms each
  assert.ok(elapsed >= 100, `expected >= 100ms elapsed, got ${elapsed}ms`);
});

test("withBackoff: returns the result once the underlying fn succeeds", async () => {
  let calls = 0;
  const result = await withBackoff(
    async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "ok";
    },
    { maxRetries: 5, baseDelayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 3);
});

test("withBackoff: throws the last error once maxRetries is exhausted", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withBackoff(
        async () => {
          calls++;
          throw new Error("permanent failure");
        },
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    /permanent failure/,
  );
  assert.equal(calls, 3); // initial attempt + 2 retries
});
