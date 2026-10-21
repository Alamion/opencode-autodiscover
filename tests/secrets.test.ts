import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { type CommandRunner, resolveSecret } from "../src/secrets.ts";

const runner = (outputs: Record<string, string>) =>
  vi.fn<CommandRunner>(async (file, args) => {
    const key = [file, ...args].join(" ");
    if (key in outputs) return outputs[key]!;
    throw new Error(`exit 1: ${key}`);
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSecret", () => {
  it("returns the first source that yields a value", async () => {
    vi.stubEnv("SECOND", "from-env");
    const run = runner({});
    const secret = await resolveSecret([{ env: "FIRST" }, { env: "SECOND" }], "litellm", { run });
    expect(secret).toEqual({ value: "from-env", origin: "env:SECOND" });
  });

  it("queries the platform keyring with service and account", async () => {
    const run = runner({
      "secret-tool lookup service opencode-autodiscover account litellm": "sk-keyring\n",
      "security find-generic-password -s opencode-autodiscover -a litellm -w": "sk-keyring\n",
    });
    const secret = await resolveSecret([{ keyring: true }], "litellm", { run });
    expect(secret?.value).toBe("sk-keyring");
    expect(secret?.origin).toBe("keyring");
  });

  it("runs commands without a shell and trims output", async () => {
    const run = runner({ "pass show litellm": "  sk-pass  " });
    const secret = await resolveSecret([{ command: ["pass", "show", "litellm"] }], "litellm", { run });
    expect(secret?.value).toBe("sk-pass");
    expect(run).toHaveBeenCalledWith("pass", ["show", "litellm"], expect.any(Number));
  });

  it("reads key files and warns when they are world-readable", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "autodiscover-"));
    const file = path.join(dir, "key");
    await writeFile(file, "sk-file\n");
    await chmod(file, 0o644);
    const warn = vi.fn<(message: string) => void>();
    const secret = await resolveSecret([{ file }], "litellm", { warn });
    expect(secret?.value).toBe("sk-file");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/chmod 600/u));
  });

  it("skips failing sources and returns undefined when nothing matches", async () => {
    const run = runner({});
    const secret = await resolveSecret(
      [{ keyring: true }, { file: "/does/not/exist" }, { env: "UNSET_FOR_TEST" }],
      "litellm",
      { run }
    );
    expect(secret).toBeUndefined();
  });
});
