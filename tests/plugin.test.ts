import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Model, Plugin, Provider } from "@opencode/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlugin } from "../src/plugin.ts";
import { template } from "./fixtures.ts";

interface Record_ {
  provider: Provider.Info;
  models: Map<string, Model.Info>;
}

/** Minimal stand-in for OpenCode's provider editor and the hooks the plugin registers. */
const fakeContext = (options: Record<string, unknown>, seed: Record_[] = []) => {
  let transform: ((editor: unknown) => void) | undefined;
  const hooks: ((event: { model: { providerID: string }; headers: Record<string, string> }) => Promise<void>)[] = [];
  const reload = vi.fn<() => Promise<void>>(async () => {});
  const build = () => {
    const records = new Map(seed.map((record) => [record.provider.id as string, structuredClone(record)]));
    transform?.({
      list: () => [...records.values()],
      get: (id: string) => records.get(id),
      add: ({ info, models }: { info: Provider.Info; models: readonly Model.Info[] }) => {
        records.set(info.id, { provider: info, models: new Map(models.map((model) => [model.id as string, model])) });
      },
    });
    return records;
  };
  const ctx = {
    options,
    provider: {
      transform: async (callback: (editor: unknown) => void) => {
        transform = callback;
        return { dispose: async () => {} };
      },
      reload,
    },
    session: {
      hook: async (_name: string, callback: (typeof hooks)[number]) => {
        hooks.push(callback);
        return { dispose: async () => {} };
      },
    },
  } as unknown as Plugin.Context;
  return { ctx, build, hooks, reload };
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const litellmServer = (validKeys: Set<string>) =>
  vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (!auth || !validKeys.has(auth.slice("Bearer ".length))) return json(401, {});
    if (url.endsWith("/v1/models")) {
      return json(200, { data: [{ id: "alibaba/qwen3.8-max" }, { id: "local\\qwen3.8-27b" }, { id: "embed-small" }] });
    }
    if (url.endsWith("/v1/model/info")) {
      return json(200, {
        data: [
          {
            model_name: "alibaba/qwen3.8-max",
            litellm_params: { model: "dashscope/qwen3.8-max" },
            model_info: { mode: "chat", input_cost_per_token: 2e-6, output_cost_per_token: 6e-6, supports_reasoning: true },
          },
          { model_name: "embed-small", model_info: { mode: "embedding" } },
        ],
      });
    }
    return json(404, {});
  });

let cacheDir: string;
const log = { info: vi.fn<(message: string) => void>(), warn: vi.fn<(message: string) => void>() };

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "autodiscover-plugin-"));
  log.info.mockClear();
  log.warn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const options = (provider: Record<string, unknown> = {}) => ({
  cacheDir,
  refreshInterval: 0,
  providers: {
    litellm: {
      name: "LiteLLM",
      baseURL: "http://proxy:4000/v1",
      apiKey: { env: "TEST_LITELLM_KEY" },
      metadata: { openrouter: false },
      ...provider,
    },
  },
});

describe("plugin", () => {
  it("registers discovered chat models with clean ids, catalog metadata and no key in settings", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-good");
    vi.stubGlobal("fetch", litellmServer(new Set(["sk-good"])));
    const seed: Record_[] = [
      {
        provider: { id: "alibaba", name: "Alibaba", activation: "auto", package: "x" } as Provider.Info,
        models: new Map([["qwen3.8-max", template("alibaba", "qwen3.8-max", { name: "Qwen3.8 Max", family: "qwen" as never })]]),
      },
    ];
    const { ctx, build } = fakeContext(options(), seed);
    await createPlugin({ log }).setup(ctx);

    const litellm = build().get("litellm")!;
    expect(litellm.provider).toMatchObject({
      name: "LiteLLM",
      activation: "enabled",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: "http://proxy:4000/v1", provider: "litellm" },
    });
    expect(JSON.stringify(litellm.provider)).not.toContain("sk-good");
    expect([...litellm.models.keys()].toSorted()).toEqual(["alibaba/qwen3.8-max", "local/qwen3.8-27b"]);
    expect(litellm.models.get("local/qwen3.8-27b")?.modelID).toBe("local\\qwen3.8-27b");
    expect(litellm.models.get("alibaba/qwen3.8-max")).toMatchObject({
      name: "Qwen3.8 Max (Alibaba)",
      family: "qwen",
      cost: [{ input: 2, output: 6 }],
    });
  });

  it("adds the key to requests through the model.request hook only", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-good");
    vi.stubGlobal("fetch", litellmServer(new Set(["sk-good"])));
    const { ctx, hooks } = fakeContext(options());
    await createPlugin({ log }).setup(ctx);

    const ours = { model: { providerID: "litellm" }, headers: {} as Record<string, string> };
    const other = { model: { providerID: "openai" }, headers: {} as Record<string, string> };
    for (const hook of hooks) {
      await hook(ours);
      await hook(other);
    }
    expect(ours.headers).toEqual({ Authorization: "Bearer sk-good" });
    expect(other.headers).toEqual({});
  });

  it("can store the key in provider settings when asked to", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-good");
    vi.stubGlobal("fetch", litellmServer(new Set(["sk-good"])));
    const { ctx, build, hooks } = fakeContext(options({ keyDelivery: "settings" }));
    await createPlugin({ log }).setup(ctx);
    expect(build().get("litellm")?.provider.settings).toMatchObject({ apiKey: "sk-good" });
    expect(hooks).toHaveLength(0);
  });

  it("re-reads a rotated key after a 401", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-old");
    const server = litellmServer(new Set(["sk-new"]));
    vi.stubGlobal("fetch", server);
    const { ctx, build } = fakeContext(options());
    const plugin = createPlugin({ log });
    const pending = plugin.setup(ctx);
    vi.stubEnv("TEST_LITELLM_KEY", "sk-new");
    await pending;
    expect(build().get("litellm")?.models.size).toBe(2);
  });

  it("serves the disk cache when the endpoint is down, and never caches the key", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-good");
    vi.stubGlobal("fetch", litellmServer(new Set(["sk-good"])));
    await createPlugin({ log }).setup(fakeContext(options()).ctx);

    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Promise.reject(new Error("ECONNREFUSED"))));
    const offline = fakeContext(options());
    await createPlugin({ log }).setup(offline.ctx);
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/keeping the last known models/u)));
    expect(offline.build().get("litellm")?.models.size).toBe(2);

    expect(await readFile(path.join(cacheDir, "endpoint-litellm.json"), "utf8")).not.toContain("sk-good");
  });

  it("keeps config-declared models of the same provider and lets discovery win on id clashes", async () => {
    vi.stubEnv("TEST_LITELLM_KEY", "sk-good");
    vi.stubGlobal("fetch", litellmServer(new Set(["sk-good"])));
    const seed: Record_[] = [
      {
        provider: { id: "litellm", name: "cfg", activation: "auto", package: "", headers: { "X-Team": "a" } } as unknown as Provider.Info,
        models: new Map([
          ["manual", template("litellm", "manual")],
          ["local/qwen3.8-27b", template("litellm", "local/qwen3.8-27b", { name: "stale" })],
        ]),
      },
    ];
    const { ctx, build } = fakeContext(options(), seed);
    await createPlugin({ log }).setup(ctx);
    const record = build().get("litellm")!;
    expect([...record.models.keys()].toSorted()).toEqual(["alibaba/qwen3.8-max", "local/qwen3.8-27b", "manual"]);
    expect(record.models.get("local/qwen3.8-27b")?.name).toBe("Qwen3.8 27B (local)");
    expect(record.provider.headers).toEqual({ "X-Team": "a" });
  });
});
