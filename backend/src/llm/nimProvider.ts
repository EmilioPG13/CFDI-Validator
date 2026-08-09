// NVIDIA NIM implementation of LlmProvider. Adapted from job-search-agents/src/lib/llm.js
// (read directly this session) -- that file's comments document real, measured behavior
// against the hosted endpoint (2026-07-24), not assumptions:
//
//   response_format: json_schema   output matched the schema exactly
//   response_format: json_object   valid JSON, but invents its own keys
//   nvext.guided_json              silently ignored; model replied in prose
//
// NVIDIA's docs recommend nvext.guided_json, but that applies to *self-hosted* NIM. On
// integrate.api.nvidia.com it is accepted and then ignored -- the worst failure mode,
// since nothing errors. Don't reinstate it without re-testing against the real endpoint.
// Confirmed live this session too: a real chatCompletion call against
// meta/llama-3.1-8b-instruct returned usedJsonSchemaMode:true with a correctly-shaped
// response in 686ms -- see the Phase 5 session notes, not just this file's own comments.
import OpenAI from "openai";
import { env } from "../env.ts";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  LlmProvider,
  ModelInfo,
} from "./provider.ts";

// A minimal structural type covering only what this file calls on an OpenAI client --
// lets nimProvider.test.ts pass a lightweight fake without depending on the real SDK's
// full type surface.
export interface NimClient {
  models: { list(): Promise<AsyncIterable<{ id: string; owned_by?: string }>> };
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<{
        choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      }>;
    };
  };
}

// Built on first use, not at import -- the OpenAI SDK throws in its constructor when the
// key is missing, so building it at module scope would crash the whole app on import,
// including code paths that never call a model (health-check-only test runs, etc.).
let _client: OpenAI | null = null;

function getClient(): NimClient {
  if (_client) return _client as unknown as NimClient;
  _client = new OpenAI({
    apiKey: env.NVIDIA_API_KEY,
    baseURL: env.NIM_BASE_URL,
    // Timeout is generous on purpose -- 167s for a trivial schema-constrained call is
    // normal on NIM's free tier, not a failure (measured in job-search-agents, not
    // guessed). Retries are correspondingly low: 429s are prevented by pacing
    // (rateLimiter.ts), not absorbed after the fact, and six retries against a 300s
    // timeout would let one stuck call stall a drain-queue invocation for 30 minutes.
    maxRetries: 3,
    timeout: 300_000,
  });
  // NimClient is a deliberately narrow structural subset of the real SDK's much more
  // precise (and stricter-typed) surface -- this cast is where that narrowing happens,
  // once, rather than fighting the real SDK's exact overload types for no functional
  // benefit (this file only ever calls .models.list() and .chat.completions.create()).
  return _client as unknown as NimClient;
}

export function isSchemaModeUnsupported(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: unknown };
  const blob = `${e?.message ?? ""} ${JSON.stringify(e?.error ?? {})}`.toLowerCase();
  return e?.status === 400 && blob.includes("response_format");
}

/** Small models sometimes wrap JSON in prose or markdown fences even in JSON mode. Pull
 *  out the outermost {...} before giving up. */
export function extractJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/** Factory, not a bare object -- lets nimProvider.test.ts build a provider around a fake
 *  NimClient (no real network) while the exported `nimProvider` singleton below still
 *  uses the real, lazily-built OpenAI client in production. */
export function createNimProvider(getNimClient: () => NimClient): LlmProvider {
  return {
    name: "nim",

    async listModels(): Promise<ModelInfo[]> {
      const page = await getNimClient().models.list();
      const models: ModelInfo[] = [];
      for await (const m of page) {
        models.push({ id: m.id, ownedBy: m.owned_by, raw: m });
      }
      return models;
    },

    async chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult> {
      const started = Date.now();
      const client = getNimClient();
      const base = {
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.1,
        max_tokens: req.maxTokens ?? 4000,
      };

      let response;
      let usedJsonSchemaMode = false;

      if (req.jsonSchema) {
        try {
          response = await client.chat.completions.create({
            ...base,
            response_format: {
              type: "json_schema",
              json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema },
            },
          });
          usedJsonSchemaMode = true;
        } catch (err) {
          if (!isSchemaModeUnsupported(err)) throw err;
          // Fallback: json_object + an explicit schema instruction. Weaker guarantee, so
          // the caller's own required-field check (see prompts/*.ts) does the real work.
          response = await client.chat.completions.create({
            ...base,
            response_format: { type: "json_object" },
            messages: [
              ...req.messages,
              {
                role: "user",
                content:
                  "Responde con un único objeto JSON y nada más -- sin prosa, sin bloques " +
                  `de código. Debe cumplir este schema:\n${JSON.stringify(req.jsonSchema.schema)}`,
              },
            ],
          });
        }
      } else {
        response = await client.chat.completions.create(base);
      }

      const choice = response.choices?.[0];
      const text = choice?.message?.content ?? "";
      const data = req.jsonSchema ? extractJson(text) : null;

      return {
        text,
        data,
        usedJsonSchemaMode,
        finishReason: choice?.finish_reason ?? null,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
        latencyMs: Date.now() - started,
        model: response.model || req.model,
      };
    },
  };
}

export const nimProvider: LlmProvider = createNimProvider(getClient);
