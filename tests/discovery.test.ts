import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchLiteLLMInfo, HttpError, parseLiteLLMInfo, parseModelList } from "../src/discovery.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseModelList", () => {
  it("keeps raw ids verbatim and reads server-specific limit fields", () => {
    const models = parseModelList({
      data: [
        { id: "local\\qwen3.8-27b", max_model_len: 262_144 },
        { id: "openrouter/x", context_length: 1000, max_completion_tokens: 100, name: "X Model" },
        { id: "" },
        { nope: true },
      ],
    });
    expect(models).toEqual([
      { rawId: "local\\qwen3.8-27b", contextLength: 262_144 },
      { rawId: "openrouter/x", contextLength: 1000, maxOutput: 100, displayName: "X Model" },
    ]);
  });
});

describe("parseLiteLLMInfo", () => {
  it("extracts prices, limits and capabilities per model name", () => {
    const info = parseLiteLLMInfo({
      data: [
        {
          model_name: "openrouter/claude-opus-5.5",
          litellm_params: { model: "openrouter/anthropic/claude-opus-5.5", custom_llm_provider: "openrouter" },
          model_info: {
            mode: "chat",
            input_cost_per_token: 0.000004,
            output_cost_per_token: 0.00002,
            cache_read_input_token_cost: 2e-7,
            max_input_tokens: 1_000_000,
            max_output_tokens: 128_000,
            supports_function_calling: true,
            supports_vision: true,
            supports_reasoning: true,
            supports_pdf_input: null,
          },
        },
        { model_name: "openrouter/claude-opus-5.5", model_info: { mode: "embedding" } },
      ],
    });
    expect(info["openrouter/claude-opus-5.5"]).toEqual({
      model: "openrouter/anthropic/claude-opus-5.5",
      provider: "openrouter",
      mode: "chat",
      inputCostPerToken: 0.000004,
      outputCostPerToken: 0.00002,
      cacheReadCostPerToken: 2e-7,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 128_000,
      supportsFunctionCalling: true,
      supportsVision: true,
      supportsReasoning: true,
    });
  });
});

describe("fetchLiteLLMInfo", () => {
  it("returns nothing for servers without the endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => json(404, {})));
    expect(await fetchLiteLLMInfo("http://ollama:11434/v1", { headers: {}, timeout: 100 })).toEqual({});
  });

  it("surfaces auth failures so the key can be refreshed", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => json(401, {})));
    await expect(fetchLiteLLMInfo("http://proxy/v1", { headers: {}, timeout: 100 })).rejects.toBeInstanceOf(HttpError);
  });

  it("sends the bearer key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(200, { data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLiteLLMInfo("http://proxy/v1", { apiKey: "sk-1", headers: { "X-Team": "a" }, timeout: 100 });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer sk-1", "X-Team": "a" });
  });
});
