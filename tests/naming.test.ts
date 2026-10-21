import { describe, expect, it } from "vitest";

import { assignCatalogIds, toCatalogId } from "../src/ids.ts";
import { groupLabel, groupOf, matchKey, prettifyModelName, withGroup } from "../src/naming.ts";

describe("prettifyModelName", () => {
  it.each([
    ["alibaba/qwen3.5-122b-a10b", "Qwen3.5 122B A10B"],
    ["qwen3.6-max-preview", "Qwen3.6 Max Preview"],
    ["openai/gpt-6.1-sol", "GPT-6.1 Sol"],
    ["alibaba/glm-5.3", "GLM-5.3"],
    ["openrouter/~deepseek/deepseek-flash-latest", "DeepSeek Flash Latest"],
    ["z-ai/glm-5.3-flashx", "GLM-5.3 FlashX"],
    ["local\\qwen3.8-27b", "Qwen3.8 27B"],
    ["qwen3:8b", "Qwen3 8B"],
    ["mixtral-8x7b-instruct", "Mixtral 8x7B Instruct"],
    ["Qwen3.5-122B-GPTQ", "Qwen3.5 122B GPTQ"],
    ["deepseek-r1", "DeepSeek R1"],
    ["gpt-oss-120b", "GPT OSS 120B"],
    ["o3-mini", "o3 Mini"],
  ])("%s → %s", (input, expected) => {
    expect(prettifyModelName(input)).toBe(expected);
  });
});

describe("groups", () => {
  it("takes the first segment of namespaced ids, including backslash ones", () => {
    expect(groupOf("local/qwen")).toBe("local");
    expect(groupOf("local\\qwen")).toBe("local");
    expect(groupOf("openrouter/~z-ai/glm")).toBe("openrouter");
    expect(groupOf("qwen")).toBeUndefined();
  });

  it("labels known groups, capitalizes unknown ones and honours overrides", () => {
    expect(groupLabel("openrouter", {})).toBe("OpenRouter");
    expect(groupLabel("local", {})).toBe("local");
    expect(groupLabel("myrack", {})).toBe("Myrack");
    expect(groupLabel("alibaba", { alibaba: false })).toBeUndefined();
    expect(groupLabel("local", { local: "GPU box" })).toBe("GPU box");
  });

  it("does not repeat a label already present", () => {
    expect(withGroup("Qwen3 (local)", "local")).toBe("Qwen3 (local)");
    expect(withGroup("Qwen3", "local")).toBe("Qwen3 (local)");
    expect(withGroup("Qwen3", undefined)).toBe("Qwen3");
  });
});

describe("matchKey", () => {
  it("unifies separators so catalogs with dots and dashes meet", () => {
    expect(matchKey("anthropic/claude-opus-5.5")).toBe(matchKey("claude-opus-5-5"));
    expect(matchKey("~deepseek/deepseek-flash")).toBe("deepseek-flash");
    expect(matchKey("qwen3:8b")).toBe("qwen3-8b");
  });
});

describe("catalog ids", () => {
  it("folds backslashes and drops characters OpenCode treats as syntax", () => {
    expect(toCatalogId("local\\qwen3.8-27b")).toBe("local/qwen3.8-27b");
    expect(toCatalogId("my model#v2")).toBe("my-model-v2");
    expect(toCatalogId("/a//b/")).toBe("a/b");
  });

  it("keeps ids unique when two raw ids normalize the same way", () => {
    const ids = assignCatalogIds(["local/qwen", "local\\qwen", "other"]);
    expect(new Set(ids.values()).size).toBe(3);
    expect(ids.get("local/qwen")).toBe("local/qwen");
    expect(ids.get("local\\qwen")).toBe("local/qwen-2");
  });
});
