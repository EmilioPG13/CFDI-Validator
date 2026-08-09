// Decorator: wraps any LlmProvider so every chatCompletion() call -- Explainer, Verifier,
// and health probes alike -- goes through ONE shared rate limiter, by construction rather
// than by each caller remembering to pace itself. The quota is per API key across the
// whole process (job-search-agents/src/lib/rateLimit.js's own reasoning, carried forward).
import { env } from "../env.ts";
import { getSharedRateLimiter, type RateLimiter } from "./rateLimiter.ts";
import type { ChatCompletionRequest, ChatCompletionResult, LlmProvider, ModelInfo } from "./provider.ts";
import { nimProvider } from "./nimProvider.ts";

export function withRateLimit(provider: LlmProvider, limiter: RateLimiter): LlmProvider {
  return {
    name: provider.name,
    // Catalog fetches are not chat-completion traffic against the same budget on NIM's
    // documented limits -- not rate-limited here.
    listModels(): Promise<ModelInfo[]> {
      return provider.listModels();
    },
    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      await limiter.acquire();
      return provider.chatCompletion(req);
    },
  };
}

/** The provider every route/job in this backend should import and use -- never the raw
 *  nimProvider directly, or a caller could accidentally bypass pacing. */
export const provider: LlmProvider = withRateLimit(nimProvider, getSharedRateLimiter(env.NIM_RPM_LIMIT));
