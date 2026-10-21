import type { DiscoveredModel, LiteLLMInfo } from "./types.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

export interface RequestOptions {
  readonly apiKey?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeout: number;
}

const getJson = async (url: string, options: RequestOptions): Promise<unknown> => {
  const headers: Record<string, string> = { ...options.headers, Accept: "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(options.timeout),
  });
  if (!response.ok) throw new HttpError(response.status, url);
  return response.json();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const bool = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** Parses an OpenAI-style `/models` list, reading the limit fields vLLM, OpenRouter and LM Studio add. */
export const parseModelList = (body: unknown): DiscoveredModel[] => {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const models: DiscoveredModel[] = [];
  for (const item of body.data) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) continue;
    const contextLength =
      int(item.context_length) ?? int(item.max_model_len) ?? int(item.max_context_length);
    const maxOutput = int(item.max_completion_tokens) ?? int(item.max_output_tokens);
    const displayName = str(item.name) ?? str(item.display_name);
    models.push({
      rawId: item.id,
      ...(contextLength ? { contextLength } : {}),
      ...(maxOutput ? { maxOutput } : {}),
      ...(displayName && displayName !== item.id ? { displayName } : {}),
    });
  }
  return models;
};

const parseLiteLLMEntry = (entry: Record<string, unknown>): LiteLLMInfo => {
  const params = isRecord(entry.litellm_params) ? entry.litellm_params : {};
  const info = isRecord(entry.model_info) ? entry.model_info : {};
  const pick = <T>(read: (value: unknown) => T | undefined, key: string): T | undefined =>
    read(info[key]) ?? read(params[key]);
  const result: Record<string, unknown> = {
    model: str(params.model) ?? str(info.key),
    provider: str(params.custom_llm_provider) ?? str(info.litellm_provider),
    mode: str(info.mode),
    inputCostPerToken: pick(num, "input_cost_per_token"),
    outputCostPerToken: pick(num, "output_cost_per_token"),
    cacheReadCostPerToken: pick(num, "cache_read_input_token_cost"),
    cacheWriteCostPerToken: pick(num, "cache_creation_input_token_cost"),
    maxInputTokens: int(info.max_input_tokens),
    maxOutputTokens: int(info.max_output_tokens) ?? int(info.max_tokens),
    supportsFunctionCalling: bool(info.supports_function_calling),
    supportsVision: bool(info.supports_vision),
    supportsPdf: bool(info.supports_pdf_input),
    supportsReasoning: bool(info.supports_reasoning),
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined)
  ) as LiteLLMInfo;
};

/** Parses LiteLLM `/model/info`; a model name with several deployments keeps the first one. */
export const parseLiteLLMInfo = (body: unknown): Record<string, LiteLLMInfo> => {
  if (!isRecord(body) || !Array.isArray(body.data)) return {};
  const result: Record<string, LiteLLMInfo> = {};
  for (const entry of body.data) {
    if (!isRecord(entry) || typeof entry.model_name !== "string") continue;
    result[entry.model_name] ??= parseLiteLLMEntry(entry);
  }
  return result;
};

export const fetchModels = async (
  baseURL: string,
  options: RequestOptions
): Promise<DiscoveredModel[]> => parseModelList(await getJson(`${baseURL}/models`, options));

/**
 * Reads LiteLLM's `/model/info`. Other servers answer 404 here, which yields an empty result;
 * auth failures still throw so the caller can retry with a fresh key.
 */
export const fetchLiteLLMInfo = async (
  baseURL: string,
  options: RequestOptions
): Promise<Record<string, LiteLLMInfo>> => {
  const root = baseURL.replace(/\/v1$/u, "");
  const urls = root === baseURL ? [`${baseURL}/model/info`] : [`${baseURL}/model/info`, `${root}/model/info`];
  for (const url of urls) {
    try {
      return parseLiteLLMInfo(await getJson(url, options));
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) throw error;
    }
  }
  return {};
};
