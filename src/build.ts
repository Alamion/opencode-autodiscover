import type { Model } from "@opencode/plugin";

import { groupLabel, groupOf, matchKey, prettifyModelName, withGroup } from "./naming.ts";
import type {
  CostOverride,
  DiscoveredModel,
  EndpointConfig,
  LiteLLMInfo,
  ModelOverride,
  OpenRouterModel,
} from "./types.ts";

const DEFAULT_CONTEXT = 32_768;
const DEFAULT_OUTPUT = 8192;
const DEFAULT_EFFORTS = ["low", "medium", "high"];
const EFFORT_IDS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const CHAT_MODES = new Set(["chat", "responses", "completion"]);
const NON_CHAT_ID = /embed|rerank|whisper|(?:^|[-_/])tts|dall-e|moderation|transcri|speech/iu;

type Cost = Model.Info["cost"][number];
type Usd = Cost["input"];

/** Rounds to 1e-6 USD per 1M tokens, enough to hide float noise like 0.0000036000000000000003. */
const usd = (value: number): Usd => (Math.round(value * 1e6) / 1e6) as Usd;
const perMillion = (perToken: number): Usd => usd(perToken * 1e6);

const costFromLiteLLM = (info: LiteLLMInfo): Cost[] | undefined => {
  if (info.inputCostPerToken === undefined && info.outputCostPerToken === undefined) return undefined;
  return [
    {
      input: perMillion(info.inputCostPerToken ?? 0),
      output: perMillion(info.outputCostPerToken ?? 0),
      cache: {
        read: perMillion(info.cacheReadCostPerToken ?? 0),
        write: perMillion(info.cacheWriteCostPerToken ?? 0),
      },
    },
  ];
};

const costFromOpenRouter = (model: OpenRouterModel): Cost[] | undefined => {
  const price = (value: string | undefined): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const pricing = model.pricing;
  if (!pricing || (price(pricing.prompt) === 0 && price(pricing.completion) === 0)) return undefined;
  return [
    {
      input: perMillion(price(pricing.prompt)),
      output: perMillion(price(pricing.completion)),
      cache: {
        read: perMillion(price(pricing.input_cache_read)),
        write: perMillion(price(pricing.input_cache_write)),
      },
    },
  ];
};

const costFromOverride = (override: CostOverride, base: Cost | undefined): Cost[] => [
  {
    input: usd(override.input ?? Number(base?.input ?? 0)),
    output: usd(override.output ?? Number(base?.output ?? 0)),
    cache: {
      read: usd(override.cacheRead ?? Number(base?.cache.read ?? 0)),
      write: usd(override.cacheWrite ?? Number(base?.cache.write ?? 0)),
    },
  },
];

const cloneCost = (cost: readonly Cost[]): Cost[] =>
  cost.map((tier) => ({ ...tier, ...(tier.tier ? { tier: { ...tier.tier } } : {}), cache: { ...tier.cache } }));

export interface BuildInput {
  readonly endpoint: EndpointConfig;
  readonly model: DiscoveredModel;
  readonly catalogId: string;
  readonly litellm?: LiteLLMInfo;
  readonly template?: Model.Info;
  readonly openrouter?: OpenRouterModel;
}

export const isChatModel = (model: DiscoveredModel, litellm: LiteLLMInfo | undefined): boolean =>
  litellm?.mode ? CHAT_MODES.has(litellm.mode) : !NON_CHAT_ID.test(model.rawId);

const overrideFor = (input: BuildInput): ModelOverride =>
  input.endpoint.models[input.model.rawId] ?? input.endpoint.models[input.catalogId] ?? {};

const displayName = (input: BuildInput, override: ModelOverride): string => {
  if (override.name) return override.name;
  const { template, model } = input;
  const base =
    model.displayName ??
    // Reuse the curated catalog name only when the alias names that exact model; an alias such
    // as `local/qwen3.8-flash-next` served by a different checkpoint keeps its own name.
    (template && matchKey(template.modelID || template.id) === matchKey(model.rawId)
      ? template.name
      : prettifyModelName(model.rawId));
  return withGroup(base, groupLabel(groupOf(model.rawId), input.endpoint.groups));
};

const limits = (input: BuildInput, override: ModelOverride): Model.Info["limit"] => {
  const { model, litellm, template, openrouter } = input;
  const context =
    override.limit?.context ??
    model.contextLength ??
    litellm?.maxInputTokens ??
    template?.limit.context ??
    openrouter?.context_length ??
    DEFAULT_CONTEXT;
  let output =
    override.limit?.output ??
    model.maxOutput ??
    litellm?.maxOutputTokens ??
    template?.limit.output ??
    openrouter?.top_provider?.max_completion_tokens ??
    DEFAULT_OUTPUT;
  // Servers often report output == context; requesting that many tokens leaves no room for input.
  if (override.limit?.output === undefined && output >= context) output = Math.floor(context / 2);
  const inputLimit = override.limit?.input;
  return { context, output, ...(inputLimit ? { input: inputLimit } : {}) };
};

const variantsFor = (reasoning: boolean, override: ModelOverride, template: Model.Info | undefined): Model.Info["variants"] => {
  if (!reasoning) return [];
  const fromTemplate = template?.variants.map((variant) => String(variant.id)).filter((id) => EFFORT_IDS.has(id));
  const efforts = override.efforts ?? (fromTemplate && fromTemplate.length > 0 ? fromTemplate : DEFAULT_EFFORTS);
  // The OpenAI-compatible package maps `reasoningEffort` to the `reasoning_effort` request field.
  return efforts.map((effort) => ({ id: effort as Model.VariantID, settings: { reasoningEffort: effort } }));
};

/** Merges every metadata source into one catalog entry; explicit overrides always win. */
export const buildModelInfo = (input: BuildInput): Model.Info => {
  const { endpoint, model, litellm, template, openrouter } = input;
  const override = overrideFor(input);
  const params = openrouter?.supported_parameters ?? [];
  const templateInput = template?.capabilities.input ?? [];

  const tools =
    override.tools ??
    litellm?.supportsFunctionCalling ??
    template?.capabilities.tools ??
    (params.length > 0 ? params.includes("tools") : undefined) ??
    true;
  const vision =
    override.vision ??
    litellm?.supportsVision ??
    (template ? templateInput.includes("image") : undefined) ??
    openrouter?.architecture?.input_modalities?.includes("image") ??
    false;
  const pdf = litellm?.supportsPdf ?? templateInput.includes("pdf");
  const reasoning =
    override.reasoning ??
    litellm?.supportsReasoning ??
    (template ? template.variants.length > 0 : undefined) ??
    (params.length > 0 ? params.includes("reasoning") : undefined) ??
    false;

  const baseCost =
    (litellm && costFromLiteLLM(litellm)) ??
    (template && template.cost.length > 0 ? cloneCost(template.cost) : undefined) ??
    (openrouter && costFromOpenRouter(openrouter)) ??
    [];
  const cost = override.cost ? costFromOverride(override.cost, baseCost[0]) : baseCost;
  const family = override.family ?? template?.family;
  const temperature = template?.capabilities.temperature;

  return {
    id: input.catalogId as Model.ID,
    modelID: model.rawId as Model.ID,
    providerID: endpoint.id as Model.Info["providerID"],
    name: displayName(input, override),
    ...(family ? { family: family as Model.Family } : {}),
    capabilities: {
      tools,
      input: ["text", ...(vision ? ["image"] : []), ...(pdf ? ["pdf"] : [])],
      output: ["text"],
      ...(temperature === undefined ? {} : { temperature }),
    },
    variants: variantsFor(reasoning, override, template),
    time: { released: template?.time.released ?? 0 },
    cost,
    status: "active",
    enabled: override.disabled !== true,
    limit: limits(input, override),
  };
};
