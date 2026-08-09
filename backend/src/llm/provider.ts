// The provider-abstraction interface every LLM role (Explainer, Verifier, health probes)
// calls through. Deliberately thin -- provider-specific quirks (json_schema->json_object
// fallback, retry policy, rate limiting) live inside nimProvider.ts/rateLimitedProvider.ts,
// not here, so swapping providers later (the NIM production-licensing risk flagged in the
// Phase 5 plan) is a new file implementing this interface, not a rewrite of every caller.

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When present, the provider MUST attempt structured output and report honestly in the
   *  result whether it actually got it (usedJsonSchemaMode below) -- this is what
   *  healthProbe.ts and every production Explainer/Verifier call both depend on. */
  jsonSchema?: JsonSchemaSpec;
}

export interface ChatCompletionResult {
  /** Raw text content, always present. */
  text: string;
  /** Parsed JSON if jsonSchema was requested and parsing succeeded; null otherwise. Never
   *  throws on unparseable output -- that's data for the caller, not an exception. */
  data: unknown | null;
  /** True only if response_format:json_schema was actually sent AND accepted (not the
   *  json_object fallback). The single most load-bearing field in this whole interface --
   *  the health check exists specifically to measure it. */
  usedJsonSchemaMode: boolean;
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number };
  latencyMs: number;
  /** Model actually used, echoed back by the provider. */
  model: string;
}

export interface ModelInfo {
  id: string;
  ownedBy?: string;
  /** Passthrough from the provider's own /v1/models entry -- not normalized further. */
  raw: unknown;
}

export interface LlmProvider {
  readonly name: string;
  listModels(): Promise<ModelInfo[]>;
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

/** Thrown when a model doesn't honor jsonSchema and the fallback also fails to produce
 *  parseable, schema-conformant JSON. Distinct from a plain network/API error so callers
 *  (the health probe especially) can tell "model is broken for structured output" apart
 *  from "model/network is unreachable." */
export class SchemaConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaConformanceError";
  }
}
