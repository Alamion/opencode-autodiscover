import type { Model, Plugin, Provider } from "@opencode/plugin";

import { buildModelInfo, isChatModel } from "./build.ts";
import { endpointCacheName, readCache, writeCache } from "./cache.ts";
import { fetchLiteLLMInfo, fetchModels, HttpError } from "./discovery.ts";
import { matchesFilter } from "./filter.ts";
import { assignCatalogIds } from "./ids.ts";
import { buildTemplateIndex, findOpenRouterModel, findTemplate, type TemplateIndex } from "./matching.ts";
import { createFileLogger, type Logger } from "./log.ts";
import { loadOpenRouterModels } from "./openrouter.ts";
import { parseOptions } from "./options.ts";
import { resolveSecret, type ResolvedSecret } from "./secrets.ts";
import { sanitizeErrorMessage } from "./security.ts";
import type { EndpointConfig, EndpointSnapshot, OpenRouterModel, PluginConfig } from "./types.ts";

export const PLUGIN_ID = "opencode-autodiscover";
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";

type ProviderEditor = Parameters<Parameters<Plugin.Context["provider"]["transform"]>[0]>[0];

class EndpointState {
  snapshot: EndpointSnapshot | undefined;
  private secret: Promise<ResolvedSecret | undefined> | undefined;

  constructor(
    readonly config: EndpointConfig,
    private readonly log: Logger
  ) {}

  /** Resolves the key once and reuses it; `fresh` forces a new lookup after an auth failure. */
  key(fresh = false): Promise<ResolvedSecret | undefined> {
    if (fresh || !this.secret) {
      this.secret = resolveSecret(this.config.apiKey, this.config.id, { warn: this.log.warn }).then((secret) => {
        if (secret) this.log.info(`${this.config.id}: API key loaded from ${secret.origin}`);
        else if (this.config.apiKey.length > 0) this.log.warn(`${this.config.id}: no API key found, sending requests without one`);
        return secret;
      });
    }
    return this.secret;
  }
}

/** Builds the catalog entries for one endpoint from its last snapshot. */
export const buildEndpointModels = (
  endpoint: EndpointConfig,
  snapshot: EndpointSnapshot,
  templates: TemplateIndex | undefined,
  openrouter: readonly OpenRouterModel[]
): Model.Info[] => {
  const ids = assignCatalogIds(snapshot.models.map((model) => model.rawId));
  const result: Model.Info[] = [];
  for (const model of snapshot.models) {
    const catalogId = ids.get(model.rawId)!;
    const litellm = endpoint.metadata.litellm ? snapshot.litellm[model.rawId] : undefined;
    const overridden = endpoint.models[model.rawId] ?? endpoint.models[catalogId];
    if (!overridden && !isChatModel(model, litellm)) continue;
    const matched = (id: string) => matchesFilter(id, endpoint.include, endpoint.exclude);
    if (!matched(model.rawId) && !matched(catalogId)) continue;
    const hints = { alias: model.rawId, underlying: litellm?.model, provider: litellm?.provider };
    const template = templates ? findTemplate(templates, hints) : undefined;
    const openrouterModel = endpoint.metadata.openrouter ? findOpenRouterModel(openrouter, hints) : undefined;
    result.push(
      buildModelInfo({
        endpoint,
        model,
        catalogId,
        ...(litellm ? { litellm } : {}),
        ...(template ? { template } : {}),
        ...(openrouterModel ? { openrouter: openrouterModel } : {}),
      })
    );
  }
  return result;
};

const applyEndpoint = (
  editor: ProviderEditor,
  endpoint: EndpointConfig,
  models: readonly Model.Info[],
  apiKey: string | undefined
): void => {
  const existing = editor.get(endpoint.id);
  const ours = new Set(models.map((model) => model.id));
  // Models declared for the same provider in config stay, unless discovery reports the same id.
  const kept = existing ? [...existing.models.values()].filter((model) => !ours.has(model.id)) : [];
  const base = existing ? structuredClone(existing.provider) : undefined;
  const settings: Record<string, unknown> = { ...base?.settings, baseURL: endpoint.baseURL, provider: endpoint.id };
  if (endpoint.keyDelivery === "settings" && apiKey) settings.apiKey = apiKey;
  else delete settings.apiKey;
  const headers = { ...base?.headers, ...endpoint.headers };
  const info: Provider.Info = {
    ...base,
    id: endpoint.id as Provider.ID,
    name: endpoint.name,
    activation: "enabled",
    package: PROVIDER_PACKAGE,
    integrationID: undefined,
    settings,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
  editor.add({ info, models: [...kept, ...models] });
};

export interface PluginDeps {
  readonly log?: Logger;
  readonly now?: () => number;
}

export const createPlugin = (deps: PluginDeps = {}): Plugin.Plugin => ({
  id: PLUGIN_ID,
  setup: async (ctx) => {
    const { config, warnings } = parseOptions(ctx.options);
    const log = deps.log ?? createFileLogger(config.cacheDir, PLUGIN_ID);
    for (const warning of warnings) log.warn(warning);
    if (config.endpoints.length === 0) {
      log.warn('no endpoints configured; add options.providers, e.g. {"litellm": {"baseURL": "http://host:4000/v1"}}');
      return;
    }

    const states = config.endpoints.map((endpoint) => new EndpointState(endpoint, log));
    const ownIds = new Set(config.endpoints.map((endpoint) => endpoint.id));
    const wantsOpenRouter = config.endpoints.some((endpoint) => endpoint.metadata.openrouter);
    let openrouter: readonly OpenRouterModel[] = [];

    await Promise.all(
      states.map(async (state) => {
        state.snapshot = await readCache<EndpointSnapshot>(config.cacheDir, endpointCacheName(state.config.id));
      })
    );
    if (wantsOpenRouter) openrouter = await loadOpenRouterModels(config.cacheDir, config.timeout);

    // Settings-mode keys must be known before the first catalog build.
    const settingsKeys = new Map<string, string>();
    for (const state of states) {
      if (state.config.keyDelivery !== "settings") continue;
      const secret = await state.key();
      if (secret) settingsKeys.set(state.config.id, secret.value);
    }

    await ctx.provider.transform((editor) => {
      const templates = config.endpoints.some((endpoint) => endpoint.metadata.catalog)
        ? buildTemplateIndex(
            editor.list().map((record) => ({ providerID: record.provider.id, models: record.models.values() })),
            ownIds
          )
        : undefined;
      for (const state of states) {
        if (!state.snapshot) continue;
        const endpointTemplates = state.config.metadata.catalog ? templates : undefined;
        const models = buildEndpointModels(state.config, state.snapshot, endpointTemplates, openrouter);
        applyEndpoint(editor, state.config, models, settingsKeys.get(state.config.id));
      }
    });

    for (const state of states) {
      if (state.config.keyDelivery !== "header" || state.config.apiKey.length === 0) continue;
      await ctx.session.hook(
        "model.request",
        async (event) => {
          if (event.model.providerID !== state.config.id) return;
          if (Object.keys(event.headers).some((name) => name.toLowerCase() === "authorization")) return;
          const secret = await state.key();
          if (secret) event.headers.Authorization = `Bearer ${secret.value}`;
        },
        { providerID: state.config.id }
      );
    }

    const refreshEndpoint = async (state: EndpointState): Promise<boolean> => {
      const { id, baseURL, headers, metadata } = state.config;
      const attempt = async (fresh: boolean) => {
        const secret = state.config.apiKey.length > 0 ? await state.key(fresh) : undefined;
        const request = { headers, timeout: config.timeout, ...(secret ? { apiKey: secret.value } : {}) };
        const [models, litellm] = await Promise.all([
          fetchModels(baseURL, request),
          metadata.litellm ? fetchLiteLLMInfo(baseURL, request) : Promise.resolve({}),
        ]);
        if (secret && state.config.keyDelivery === "settings") settingsKeys.set(id, secret.value);
        return { models, litellm };
      };
      let result: Awaited<ReturnType<typeof attempt>>;
      try {
        result = await attempt(false);
      } catch (error) {
        const unauthorized = error instanceof HttpError && (error.status === 401 || error.status === 403);
        if (!unauthorized || state.config.apiKey.length === 0) throw error;
        // The key may have been rotated in the keyring since startup.
        result = await attempt(true);
      }
      const previous = state.snapshot;
      const changed =
        !previous ||
        JSON.stringify(previous.models) !== JSON.stringify(result.models) ||
        JSON.stringify(previous.litellm) !== JSON.stringify(result.litellm);
      const snapshot: EndpointSnapshot = { ...result, fetchedAt: (deps.now ?? Date.now)() };
      state.snapshot = snapshot;
      await writeCache(config.cacheDir, endpointCacheName(id), snapshot);
      if (changed) log.info(`${id}: discovered ${result.models.length} models at ${baseURL}`);
      return changed;
    };

    let running: Promise<void> | undefined;
    const refresh = (): Promise<void> => {
      running ??= (async () => {
        try {
          if (wantsOpenRouter) openrouter = await loadOpenRouterModels(config.cacheDir, config.timeout);
          const outcomes = await Promise.all(
            states.map(async (state) => {
              try {
                return await refreshEndpoint(state);
              } catch (error) {
                const secret = await state.key().catch(() => undefined);
                const message = sanitizeErrorMessage(error, secret ? [secret.value] : []);
                log.warn(`${state.config.id}: discovery failed (${message}); keeping the last known models`);
                return false;
              }
            })
          );
          if (outcomes.some(Boolean)) await ctx.provider.reload();
        } finally {
          running = undefined;
        }
      })();
      return running;
    };

    // Without a cached snapshot the catalog would be empty, so wait for the first discovery;
    // otherwise serve the cache immediately and refresh in the background.
    if (states.some((state) => !state.snapshot)) await refresh();
    else void refresh();

    const timer = config.refreshInterval > 0 ? setInterval(() => void refresh(), config.refreshInterval * 1000) : undefined;
    timer?.unref?.();
    return () => {
      if (timer) clearInterval(timer);
    };
  },
});

export type { PluginConfig };
export default createPlugin();
