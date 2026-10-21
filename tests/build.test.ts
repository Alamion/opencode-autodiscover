import { describe, expect, it } from "vitest";

import { buildModelInfo, isChatModel } from "../src/build.ts";
import { endpoint, template } from "./fixtures.ts";

describe("buildModelInfo", () => {
  it("keeps the raw id for requests and a clean id for the catalog", () => {
    const info = buildModelInfo({
      endpoint: endpoint(),
      model: { rawId: "local\\qwen3.8-27b" },
      catalogId: "local/qwen3.8-27b",
    });
    expect(info).toMatchObject({
      id: "local/qwen3.8-27b",
      modelID: "local\\qwen3.8-27b",
      providerID: "litellm",
      name: "Qwen3.8 27B (local)",
      limit: { context: 32_768, output: 8192 },
    });
  });

  it("converts LiteLLM per-token prices to USD per 1M tokens without float noise", () => {
    const info = buildModelInfo({
      endpoint: endpoint(),
      model: { rawId: "alibaba/qwen3.5-397b-a17b" },
      catalogId: "alibaba/qwen3.5-397b-a17b",
      litellm: { inputCostPerToken: 6e-7, outputCostPerToken: 0.0000036000000000000003, cacheReadCostPerToken: 2e-7 },
    });
    expect(info.cost).toEqual([{ input: 0.6, output: 3.6, cache: { read: 0.2, write: 0 } }]);
  });

  it("prefers proxy data over catalog data and catalog over OpenRouter", () => {
    const info = buildModelInfo({
      endpoint: endpoint(),
      model: { rawId: "openrouter/claude-opus-5.5" },
      catalogId: "openrouter/claude-opus-5.5",
      litellm: { maxInputTokens: 1_000_000, supportsReasoning: true, supportsVision: true },
      template: template("openrouter", "anthropic/claude-opus-5.5", {
        name: "Claude Opus 5.5",
        family: "claude-opus" as never,
        cost: [{ input: 5, output: 25, cache: { read: 0.5, write: 6.25 } }] as never,
        limit: { context: 500_000, output: 128_000 },
        variants: [{ id: "high" }, { id: "max" }, { id: "thinking" }] as never,
      }),
      openrouter: { id: "anthropic/claude-opus-5.5", context_length: 1, pricing: { prompt: "1", completion: "1" } },
    });
    expect(info.name).toBe("Claude Opus 5.5 (OpenRouter)");
    expect(info.family).toBe("claude-opus");
    expect(info.limit).toEqual({ context: 1_000_000, output: 128_000 });
    expect(info.cost[0]?.input).toBe(5);
    expect(info.capabilities.input).toEqual(["text", "image"]);
    expect(info.variants).toEqual([
      { id: "high", settings: { reasoningEffort: "high" } },
      { id: "max", settings: { reasoningEffort: "max" } },
    ]);
  });

  it("keeps the alias name when the catalog match is a different checkpoint", () => {
    const info = buildModelInfo({
      endpoint: endpoint(),
      model: { rawId: "local/qwen3.8-flash-next" },
      catalogId: "local/qwen3.8-flash-next",
      template: template("alibaba", "qwen3.5-122b-a10b", { name: "Qwen3.5 122B-A10B" }),
    });
    expect(info.name).toBe("Qwen3.8 Flash Next (local)");
  });

  it("halves an output limit that would consume the whole context", () => {
    const info = buildModelInfo({
      endpoint: endpoint(),
      model: { rawId: "local/x", contextLength: 262_144 },
      catalogId: "local/x",
      litellm: { maxOutputTokens: 262_144 },
    });
    expect(info.limit).toEqual({ context: 262_144, output: 131_072 });
  });

  it("applies user overrides last", () => {
    const info = buildModelInfo({
      endpoint: endpoint({
        groups: { local: false },
        models: {
          "local/x": {
            name: "Rack Qwen",
            limit: { context: 65_536, output: 65_536 },
            cost: { input: 0.1 },
            reasoning: true,
            efforts: ["low", "high"],
            disabled: true,
          },
        },
      }),
      model: { rawId: "local/x" },
      catalogId: "local/x",
      litellm: { inputCostPerToken: 1e-6, outputCostPerToken: 2e-6 },
    });
    expect(info).toMatchObject({
      name: "Rack Qwen",
      enabled: false,
      limit: { context: 65_536, output: 65_536 },
      cost: [{ input: 0.1, output: 2 }],
    });
    expect(info.variants.map((variant) => variant.id)).toEqual(["low", "high"]);
  });

  it("names models without a group plainly", () => {
    expect(buildModelInfo({ endpoint: endpoint(), model: { rawId: "qwen3:8b" }, catalogId: "qwen3:8b" }).name).toBe(
      "Qwen3 8B"
    );
  });
});

describe("isChatModel", () => {
  it("uses the LiteLLM mode when present and id hints otherwise", () => {
    expect(isChatModel({ rawId: "text-embedding-3" }, undefined)).toBe(false);
    expect(isChatModel({ rawId: "my-alias" }, { mode: "embedding" })).toBe(false);
    expect(isChatModel({ rawId: "qwen" }, { mode: "chat" })).toBe(true);
    expect(isChatModel({ rawId: "qwen" }, undefined)).toBe(true);
  });
});
