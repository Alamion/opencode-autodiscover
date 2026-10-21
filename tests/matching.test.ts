import { describe, expect, it } from "vitest";

import { buildTemplateIndex, findOpenRouterModel, findTemplate } from "../src/matching.ts";
import { template } from "./fixtures.ts";

const index = buildTemplateIndex(
  [
    {
      providerID: "alibaba",
      models: [template("alibaba", "qwen3.8-max"), template("alibaba", "qwen3.5-122b-a10b")],
    },
    { providerID: "anthropic", models: [template("anthropic", "claude-opus-5-5")] },
    {
      providerID: "openrouter",
      models: [template("openrouter", "anthropic/claude-opus-5.5"), template("openrouter", "qwen/qwen3.8-max")],
    },
    { providerID: "deepseek", models: [template("deepseek", "deepseek-flash")] },
    {
      providerID: "openai",
      models: [
        template("openai", "gpt-6.1-sol"),
        // A models.dev "mode" shares the base modelID.
        template("openai", "gpt-6.1-sol-ultrafast", { modelID: "gpt-6.1-sol" as never, name: "GPT-6.1 Sol Ultrafast" }),
      ],
    },
    { providerID: "litellm", models: [template("litellm", "qwen3.8-max")] },
  ],
  new Set(["litellm"])
);

describe("findTemplate", () => {
  it("follows LiteLLM's provider prefix to the right catalog", () => {
    expect(findTemplate(index, { alias: "x/y", underlying: "dashscope/qwen3.8-max" })).toMatchObject({
      providerID: "alibaba",
      id: "qwen3.8-max",
    });
    expect(
      findTemplate(index, { alias: "openrouter/claude-opus-5.5", underlying: "openrouter/anthropic/claude-opus-5.5" })
    ).toMatchObject({ providerID: "openrouter" });
  });

  it("uses custom_llm_provider when the underlying model has no prefix", () => {
    expect(findTemplate(index, { alias: "q", underlying: "qwen3.8-max", provider: "dashscope" })).toMatchObject({
      providerID: "alibaba",
    });
  });

  it("treats the alias prefix as a catalog provider", () => {
    expect(findTemplate(index, { alias: "alibaba/qwen3.8-max" })).toMatchObject({ providerID: "alibaba" });
  });

  it("prefers first-party catalogs for bare ids and never matches its own provider", () => {
    expect(findTemplate(index, { alias: "claude-opus-5.5" })).toMatchObject({ providerID: "anthropic" });
    expect(findTemplate(index, { alias: "local/qwen3.8-max" })?.providerID).toBe("alibaba");
  });

  it("strips quantization and -latest suffixes, then accepts a unique prefix", () => {
    expect(findTemplate(index, { alias: "openrouter/~deepseek/deepseek-flash-latest" })).toMatchObject({
      id: "deepseek-flash",
    });
    expect(findTemplate(index, { alias: "local/x", underlying: "qwen3.5-122b-gptq" })).toMatchObject({
      id: "qwen3.5-122b-a10b",
    });
  });

  it("keeps base models ahead of models.dev modes sharing their modelID", () => {
    expect(findTemplate(index, { alias: "openai/gpt-6.1-sol" })?.id).toBe("gpt-6.1-sol");
  });

  it("gives up rather than guessing", () => {
    expect(findTemplate(index, { alias: "local/qwen3.8-27b", underlying: "qwen3.8-27b" })).toBeUndefined();
  });
});

describe("findOpenRouterModel", () => {
  const models = [{ id: "qwen/qwen3.8-27b" }, { id: "anthropic/claude-opus-5.5" }];

  it("matches exact OpenRouter ids and falls back to the model name", () => {
    expect(findOpenRouterModel(models, { alias: "x", underlying: "openrouter/anthropic/claude-opus-5.5" })?.id).toBe(
      "anthropic/claude-opus-5.5"
    );
    expect(findOpenRouterModel(models, { alias: "local/qwen3.8-27b" })?.id).toBe("qwen/qwen3.8-27b");
  });
});
