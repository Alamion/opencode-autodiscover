import { readCache, writeCache } from "./cache.ts";
import type { OpenRouterModel } from "./types.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/models";
const CACHE_FILE = "openrouter.json";
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  readonly fetchedAt: number;
  readonly models: readonly OpenRouterModel[];
}

const isModel = (value: unknown): value is OpenRouterModel =>
  typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";

/** Returns OpenRouter's public model list, from a 24h disk cache when fresh, stale cache when offline. */
export const loadOpenRouterModels = async (
  cacheDir: string,
  timeout: number,
  now = Date.now()
): Promise<readonly OpenRouterModel[]> => {
  const cached = await readCache<CacheEntry>(cacheDir, CACHE_FILE);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.models;
  try {
    const response = await fetch(ENDPOINT, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return cached?.models ?? [];
    const body = (await response.json()) as { data?: unknown };
    const models = Array.isArray(body.data) ? body.data.filter(isModel) : [];
    if (models.length > 0) await writeCache(cacheDir, CACHE_FILE, { fetchedAt: now, models });
    return models;
  } catch {
    return cached?.models ?? [];
  }
};
