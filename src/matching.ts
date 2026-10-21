import type { Model } from "@opencode/plugin";

import { matchKey } from "./naming.ts";
import type { OpenRouterModel } from "./types.ts";

/** LiteLLM provider prefixes → models.dev provider ids. */
const LITELLM_PROVIDERS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["anthropic"],
  azure: ["azure"],
  bedrock: ["amazon-bedrock"],
  cerebras: ["cerebras"],
  cohere: ["cohere"],
  dashscope: ["alibaba", "alibaba-cn"],
  deepseek: ["deepseek"],
  fireworks_ai: ["fireworks-ai"],
  gemini: ["google"],
  groq: ["groq"],
  mistral: ["mistral"],
  moonshot: ["moonshotai"],
  nvidia_nim: ["nvidia"],
  openai: ["openai"],
  openrouter: ["openrouter"],
  perplexity: ["perplexity"],
  together_ai: ["togetherai"],
  vertex_ai: ["google-vertex"],
  xai: ["xai"],
  zai: ["zai", "zhipuai"],
};

/** First-party catalogs win over resellers when the same model appears in several. */
const PREFERRED = [
  "openai", "anthropic", "google", "alibaba", "deepseek", "zai", "zhipuai", "moonshotai",
  "mistral", "xai", "minimax", "openrouter",
];

const NOISE_SUFFIXES = [
  /-(?:gptq|awq|gguf|mlx|exl2|fp8|fp16|bf16|int4|int8|nvfp4|w4a16|w8a8)(?:-.*)?$/u,
  /-(?:latest|preview)$/u,
  /-(?:instruct|chat|it)$/u,
  /-\d{4}(?:-\d{2}-\d{2})?$/u,
];

export interface TemplateIndex {
  readonly byProvider: ReadonlyMap<string, ReadonlyMap<string, Model.Info>>;
  readonly byKey: ReadonlyMap<string, readonly Model.Info[]>;
}

export interface TemplateSource {
  readonly providerID: string;
  readonly models: Iterable<Model.Info>;
}

const rank = (model: Model.Info): number => {
  const index = PREFERRED.indexOf(model.providerID);
  return index === -1 ? PREFERRED.length : index;
};

const hasCost = (model: Model.Info): boolean =>
  model.cost.some((tier) => Number(tier.input) > 0 || Number(tier.output) > 0);

const better = (a: Model.Info, b: Model.Info): number =>
  rank(a) - rank(b) ||
  Number(hasCost(b)) - Number(hasCost(a)) ||
  b.limit.context - a.limit.context;

export const buildTemplateIndex = (
  sources: Iterable<TemplateSource>,
  skipProviders: ReadonlySet<string>
): TemplateIndex => {
  const byProvider = new Map<string, Map<string, Model.Info>>();
  const byKey = new Map<string, Model.Info[]>();
  for (const source of sources) {
    if (skipProviders.has(source.providerID)) continue;
    const models = new Map<string, Model.Info>();
    for (const model of source.models) {
      // models.dev "modes" (e.g. `gpt-x-ultrafast`) reuse the base modelID; only `id` is unique.
      const key = matchKey(model.id);
      models.set(model.id.toLowerCase(), model);
      models.set(`key:${key}`, model);
      byKey.set(key, [...(byKey.get(key) ?? []), model]);
    }
    for (const model of source.models) {
      const alias = model.modelID.toLowerCase();
      if (!models.has(alias)) models.set(alias, model);
    }
    byProvider.set(source.providerID, models);
  }
  for (const list of byKey.values()) list.sort(better);
  return { byProvider, byKey };
};

const inProviders = (
  index: TemplateIndex,
  providers: readonly string[],
  id: string
): Model.Info | undefined => {
  for (const providerID of providers) {
    const models = index.byProvider.get(providerID);
    const found = models?.get(id.toLowerCase()) ?? models?.get(`key:${matchKey(id)}`);
    if (found) return found;
  }
  return undefined;
};

/** Splits `dashscope/qwen3.8-max` into the catalog providers it implies and the remaining id. */
const scoped = (
  index: TemplateIndex,
  id: string,
  providerHint?: string
): { providers: readonly string[]; rest: string } | undefined => {
  const slash = id.indexOf("/");
  if (slash > 0) {
    const head = id.slice(0, slash);
    const providers = LITELLM_PROVIDERS[head] ?? (index.byProvider.has(head) ? [head] : undefined);
    if (providers) return { providers, rest: id.slice(slash + 1) };
  }
  const hinted = providerHint ? LITELLM_PROVIDERS[providerHint] : undefined;
  return hinted ? { providers: hinted, rest: id } : undefined;
};

const stripNoise = (key: string): string => {
  let result = key;
  for (let changed = true; changed; ) {
    changed = false;
    for (const pattern of NOISE_SUFFIXES) {
      const next = result.replace(pattern, "");
      if (next !== result && next.length > 0) {
        result = next;
        changed = true;
      }
    }
  }
  return result;
};

const byPrefix = (index: TemplateIndex, key: string): Model.Info | undefined => {
  const keys = [...index.byKey.keys()].filter((candidate) => candidate.startsWith(`${key}-`));
  return keys.length === 1 ? index.byKey.get(keys[0]!)?.[0] : undefined;
};

export interface TemplateHints {
  /** Id as the endpoint lists it (LiteLLM alias). */
  readonly alias: string;
  /** Upstream model behind the alias (LiteLLM `litellm_params.model`). */
  readonly underlying?: string;
  /** LiteLLM `custom_llm_provider`. */
  readonly provider?: string;
}

/** Finds the catalog definition describing a discovered model, most specific evidence first. */
export const findTemplate = (index: TemplateIndex, hints: TemplateHints): Model.Info | undefined => {
  const ids = [hints.underlying, hints.alias].filter((id): id is string => Boolean(id));
  for (const id of ids) {
    const scope = scoped(index, id, id === hints.underlying ? hints.provider : undefined);
    const found = scope && inProviders(index, scope.providers, scope.rest);
    if (found) return found;
  }
  for (const id of ids) {
    const found = index.byKey.get(matchKey(id))?.[0];
    if (found) return found;
  }
  for (const id of ids) {
    const key = stripNoise(matchKey(id));
    const found = index.byKey.get(key)?.[0] ?? byPrefix(index, key);
    if (found) return found;
  }
  return undefined;
};

/** Same lookup over OpenRouter's list, whose ids look like `vendor/model`. */
export const findOpenRouterModel = (
  models: readonly OpenRouterModel[],
  hints: TemplateHints
): OpenRouterModel | undefined => {
  const ids = [hints.underlying, hints.alias].filter((id): id is string => Boolean(id));
  const exact = new Map(models.map((model) => [model.id.toLowerCase(), model]));
  for (const id of ids) {
    const lower = id.toLowerCase().replace(/^openrouter\//u, "");
    const found = exact.get(lower);
    if (found) return found;
  }
  for (const id of ids) {
    const keys = [matchKey(id), stripNoise(matchKey(id))];
    const found = models.find((model) => keys.includes(matchKey(model.id)));
    if (found) return found;
  }
  return undefined;
};
