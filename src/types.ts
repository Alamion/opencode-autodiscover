/** Where an API key comes from. A bare string is a literal key (discouraged). */
export type SecretSource =
  | string
  | { readonly env: string }
  | { readonly file: string }
  | { readonly command: readonly string[] }
  | {
      readonly keyring:
        | true
        | {
            readonly service?: string;
            readonly account?: string;
          };
    };

/** Costs are USD per 1M tokens, the unit OpenCode uses everywhere. */
export interface CostOverride {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ModelOverride {
  readonly name?: string;
  readonly family?: string;
  readonly disabled?: boolean;
  readonly limit?: {
    readonly context?: number;
    readonly input?: number;
    readonly output?: number;
  };
  readonly cost?: CostOverride;
  readonly tools?: boolean;
  readonly reasoning?: boolean;
  readonly vision?: boolean;
  /** Reasoning effort levels exposed as model variants. */
  readonly efforts?: readonly string[];
}

export interface MetadataSources {
  /** LiteLLM `/model/info` (prices, limits, capabilities configured on the proxy). */
  readonly litellm: boolean;
  /** models.dev definitions already loaded into the OpenCode catalog. */
  readonly catalog: boolean;
  /** OpenRouter public model list (cached on disk). */
  readonly openrouter: boolean;
}

export interface EndpointConfig {
  readonly id: string;
  readonly name: string;
  readonly baseURL: string;
  readonly apiKey: readonly SecretSource[];
  readonly headers: Readonly<Record<string, string>>;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly metadata: MetadataSources;
  /** Label appended to model names per id prefix (`local/x` → "local"); `false` hides it. */
  readonly groups: Readonly<Record<string, string | false>>;
  readonly models: Readonly<Record<string, ModelOverride>>;
  /**
   * `header` sends the key from a request hook so it never enters the provider catalog;
   * `settings` stores it as the provider apiKey like a config-defined provider would.
   */
  readonly keyDelivery: "header" | "settings";
}

export interface PluginConfig {
  readonly endpoints: readonly EndpointConfig[];
  /** Seconds between background refreshes; 0 disables polling. */
  readonly refreshInterval: number;
  /** Milliseconds per HTTP request. */
  readonly timeout: number;
  readonly cacheDir: string;
}

/** A model as reported by the endpoint, before enrichment. */
export interface DiscoveredModel {
  /** Exact id the endpoint expects in requests. Never rewritten. */
  readonly rawId: string;
  readonly contextLength?: number;
  readonly maxOutput?: number;
  readonly displayName?: string;
}

/** The subset of a LiteLLM deployment's `/model/info` entry this plugin reads. */
export interface LiteLLMInfo {
  /** Underlying model, e.g. `dashscope/qwen3.8-max` or `openrouter/anthropic/claude-opus-5.5`. */
  readonly model?: string;
  readonly provider?: string;
  readonly mode?: string;
  readonly inputCostPerToken?: number;
  readonly outputCostPerToken?: number;
  readonly cacheReadCostPerToken?: number;
  readonly cacheWriteCostPerToken?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly supportsFunctionCalling?: boolean;
  readonly supportsVision?: boolean;
  readonly supportsPdf?: boolean;
  readonly supportsReasoning?: boolean;
}

export interface OpenRouterModel {
  readonly id: string;
  readonly name?: string;
  readonly context_length?: number;
  readonly pricing?: {
    readonly prompt?: string;
    readonly completion?: string;
    readonly input_cache_read?: string;
    readonly input_cache_write?: string;
  };
  readonly top_provider?: { readonly max_completion_tokens?: number | null };
  readonly architecture?: { readonly input_modalities?: readonly string[] };
  readonly supported_parameters?: readonly string[];
}

/** Everything known about one endpoint after a refresh. Holds no secrets; safe to cache on disk. */
export interface EndpointSnapshot {
  readonly models: readonly DiscoveredModel[];
  readonly litellm: Readonly<Record<string, LiteLLMInfo>>;
  readonly fetchedAt: number;
}
