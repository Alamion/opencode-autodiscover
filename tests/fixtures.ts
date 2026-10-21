import type { Model } from "@opencode/plugin";

import { parseOptions } from "../src/options.ts";
import type { EndpointConfig } from "../src/types.ts";

export const template = (providerID: string, id: string, patch: Partial<Model.Info> = {}): Model.Info =>
  ({
    id,
    modelID: id,
    providerID,
    name: id,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 128_000, output: 16_000 },
    ...patch,
  }) as Model.Info;

export const endpoint = (patch: Record<string, unknown> = {}): EndpointConfig => {
  const { config } = parseOptions({
    providers: { litellm: { baseURL: "http://proxy:4000/v1", apiKey: false, ...patch } },
  });
  return config.endpoints[0]!;
};
