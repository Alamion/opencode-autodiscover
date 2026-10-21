import { describe, expect, it } from "vitest";

import { defaultSecretSources, parseOptions } from "../src/options.ts";

describe("parseOptions", () => {
  it("reads the providers map and fills defaults", () => {
    const { config, warnings } = parseOptions({
      providers: { litellm: { baseURL: "http://proxy:4000/v1/", name: "LiteLLM" } },
    });
    expect(warnings).toEqual([]);
    expect(config.refreshInterval).toBe(300);
    const [endpoint] = config.endpoints;
    expect(endpoint).toMatchObject({
      id: "litellm",
      name: "LiteLLM",
      baseURL: "http://proxy:4000/v1",
      keyDelivery: "header",
      metadata: { litellm: true, catalog: true, openrouter: true },
    });
    expect(endpoint?.apiKey).toEqual(defaultSecretSources("litellm"));
  });

  it("looks up the keyring first, then the env variables of both plugin generations", () => {
    expect(defaultSecretSources("my-proxy")).toEqual([
      { keyring: { service: "opencode-autodiscover", account: "my-proxy" } },
      { env: "OPENCODE_AUTODISCOVER_MY_PROXY_API_KEY" },
      { env: "OPENCODE_LOCAL_MY_PROXY_API_KEY" },
    ]);
  });

  it("accepts the 2.x endpoints array", () => {
    const { config } = parseOptions({ endpoints: [{ id: "ollama", baseURL: "http://localhost:11434/v1" }] });
    expect(config.endpoints.map((endpoint) => endpoint.id)).toEqual(["ollama"]);
  });

  it("warns about literal keys and rejects bad endpoints", () => {
    const { config, warnings } = parseOptions({
      providers: {
        good: { baseURL: "https://x/v1", apiKey: "sk-123" },
        "bad/id": { baseURL: "https://x/v1" },
        nourl: { baseURL: "ftp://x" },
      },
    });
    expect(config.endpoints.map((endpoint) => endpoint.id)).toEqual(["good"]);
    expect(warnings.join("\n")).toMatch(/plain-text/u);
    expect(warnings.join("\n")).toMatch(/bad\/id/u);
    expect(warnings.join("\n")).toMatch(/nourl/u);
  });

  it("supports apiKey: false and source chains", () => {
    const { config } = parseOptions({
      providers: {
        open: { baseURL: "http://a/v1", apiKey: false },
        chain: { baseURL: "http://b/v1", apiKey: [{ keyring: true }, { env: "KEY" }, { command: ["pass", "show", "x"] }] },
      },
    });
    expect(config.endpoints[0]?.apiKey).toEqual([]);
    expect(config.endpoints[1]?.apiKey).toEqual([{ keyring: true }, { env: "KEY" }, { command: ["pass", "show", "x"] }]);
  });

  it("allows disabling polling", () => {
    expect(parseOptions({ refreshInterval: 0 }).config.refreshInterval).toBe(0);
  });
});
