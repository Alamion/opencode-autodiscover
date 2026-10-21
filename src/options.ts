import os from "node:os";
import path from "node:path";

import { isValidUrl } from "./security.ts";
import type {
  EndpointConfig,
  MetadataSources,
  ModelOverride,
  PluginConfig,
  SecretSource,
} from "./types.ts";

const DEFAULT_REFRESH_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 10_000;

export const KEYRING_SERVICE = "opencode-autodiscover";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const stringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item;
  }
  return result;
};

const positive = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;

export const envName = (prefix: string, id: string): string =>
  `${prefix}_${id.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_")}_API_KEY`;

/** Key lookup order when the user configured no `apiKey`. */
export const defaultSecretSources = (id: string): SecretSource[] => [
  { keyring: { service: KEYRING_SERVICE, account: id } },
  { env: envName("OPENCODE_AUTODISCOVER", id) },
  // Variable name used by opencode-autodiscover 1.x.
  { env: envName("OPENCODE_LOCAL", id) },
];

const parseSecret = (value: unknown): SecretSource | undefined => {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (typeof value.env === "string") return { env: value.env };
  if (typeof value.file === "string") return { file: value.file };
  if (Array.isArray(value.command) && value.command.length > 0) {
    return { command: stringArray(value.command) };
  }
  if (value.keyring === true) return { keyring: true };
  if (isRecord(value.keyring)) {
    const { service, account } = value.keyring;
    return {
      keyring: {
        ...(typeof service === "string" ? { service } : {}),
        ...(typeof account === "string" ? { account } : {}),
      },
    };
  }
  return undefined;
};

const parseSecrets = (
  value: unknown,
  id: string,
  warnings: string[]
): SecretSource[] => {
  if (value === false) return [];
  if (value === undefined || value === null) return defaultSecretSources(id);
  const items = Array.isArray(value) ? value : [value];
  const sources = items
    .map(parseSecret)
    .filter((item) => item !== undefined);
  if (sources.length === 0) {
    warnings.push(`${id}: apiKey has no usable source, using defaults`);
    return defaultSecretSources(id);
  }
  if (sources.some((source) => typeof source === "string")) {
    warnings.push(
      `${id}: apiKey is a plain-text literal; prefer {"keyring": true}, {"env": ...} or {"command": [...]}`
    );
  }
  return sources;
};

const parseMetadata = (value: unknown): MetadataSources => {
  const input = isRecord(value) ? value : {};
  return {
    litellm: input.litellm !== false,
    catalog: input.catalog !== false && input.modelsDev !== false,
    openrouter: input.openrouter !== false,
  };
};

const parseGroups = (value: unknown): Record<string, string | false> => {
  if (!isRecord(value)) return {};
  const result: Record<string, string | false> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || item === false) result[key] = item;
  }
  return result;
};

const parseModels = (value: unknown): Record<string, ModelOverride> => {
  if (!isRecord(value)) return {};
  const result: Record<string, ModelOverride> = {};
  for (const [key, item] of Object.entries(value)) {
    // Overrides are user-authored; keep the documented fields and drop the rest.
    if (isRecord(item)) result[key] = item as ModelOverride;
  }
  return result;
};

const parseEndpoint = (
  id: string,
  input: Record<string, unknown>,
  warnings: string[]
): EndpointConfig | undefined => {
  if (!/^[^/#\s]+$/u.test(id)) {
    warnings.push(`${id}: provider id must not contain "/", "#" or spaces`);
    return undefined;
  }
  const baseURL =
    typeof input.baseURL === "string" ? input.baseURL.replace(/\/+$/u, "") : "";
  if (!isValidUrl(baseURL)) {
    warnings.push(`${id}: baseURL is missing or not an http(s) URL`);
    return undefined;
  }
  return {
    id,
    name: typeof input.name === "string" ? input.name : id,
    baseURL,
    apiKey: parseSecrets(input.apiKey, id, warnings),
    headers: stringRecord(input.headers),
    include: stringArray(input.include),
    exclude: stringArray(input.exclude),
    metadata: parseMetadata(input.metadata),
    groups: parseGroups(input.groups),
    models: parseModels(input.models),
    keyDelivery: input.keyDelivery === "settings" ? "settings" : "header",
  };
};

export const parseOptions = (
  options: Readonly<Record<string, unknown>>
): { config: PluginConfig; warnings: string[] } => {
  const warnings: string[] = [];
  const endpoints: EndpointConfig[] = [];

  if (isRecord(options.providers)) {
    for (const [id, value] of Object.entries(options.providers)) {
      if (!isRecord(value)) continue;
      const endpoint = parseEndpoint(id, value, warnings);
      if (endpoint) endpoints.push(endpoint);
    }
  }
  // Array form accepted by opencode-autodiscover 2.x.
  if (Array.isArray(options.endpoints)) {
    for (const value of options.endpoints) {
      if (!isRecord(value) || typeof value.id !== "string") continue;
      const endpoint = parseEndpoint(value.id, value, warnings);
      if (endpoint) endpoints.push(endpoint);
    }
  }

  const seen = new Set<string>();
  const unique = endpoints.filter((endpoint) => {
    if (seen.has(endpoint.id)) {
      warnings.push(`${endpoint.id}: declared twice, keeping the first`);
      return false;
    }
    seen.add(endpoint.id);
    return true;
  });

  const interval = options.refreshInterval;
  return {
    config: {
      endpoints: unique,
      refreshInterval:
        interval === 0 ? 0 : (positive(interval) ?? DEFAULT_REFRESH_SECONDS),
      timeout: positive(options.timeout) ?? DEFAULT_TIMEOUT_MS,
      cacheDir:
        typeof options.cacheDir === "string"
          ? options.cacheDir.replace(/^~(?=\/|$)/u, os.homedir())
          : (process.env.OPENCODE_AUTODISCOVER_CACHE_DIR ??
            path.join(
              process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
              "opencode-autodiscover"
            )),
    },
    warnings,
  };
};
