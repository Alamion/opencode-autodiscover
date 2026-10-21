import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { KEYRING_SERVICE } from "./options.ts";
import type { SecretSource } from "./types.ts";

/** Runs a program without a shell and returns trimmed stdout; rejects on non-zero exit. */
export type CommandRunner = (
  file: string,
  args: readonly string[],
  timeout: number
) => Promise<string>;

// Unlocking a keyring can show a desktop prompt, so allow time for a human.
const COMMAND_TIMEOUT_MS = 60_000;

export const runCommand: CommandRunner = (file, args, timeout) => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(
    file,
    [...args],
    { timeout, windowsHide: true, maxBuffer: 64 * 1024 },
    (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout).trim());
    }
  );
  return promise;
};

export interface ResolvedSecret {
  readonly value: string;
  /** Human-readable origin without the secret, for logs. */
  readonly origin: string;
}

const expandHome = (file: string): string =>
  file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;

const keyringCommand = (
  service: string,
  account: string
): [string, string[]] | undefined => {
  if (process.platform === "linux" || process.platform === "freebsd") {
    return ["secret-tool", ["lookup", "service", service, "account", account]];
  }
  if (process.platform === "darwin") {
    return [
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
    ];
  }
  return undefined;
};

const describe = (source: SecretSource): string => {
  if (typeof source === "string") return "literal";
  if ("env" in source) return `env:${source.env}`;
  if ("file" in source) return `file:${source.file}`;
  if ("command" in source) return `command:${source.command[0] ?? ""}`;
  return "keyring";
};

const readOne = async (
  source: SecretSource,
  providerID: string,
  run: CommandRunner,
  warn: (message: string) => void
): Promise<string | undefined> => {
  if (typeof source === "string") return source;
  if ("env" in source) return process.env[source.env];
  if ("file" in source) {
    const file = expandHome(source.file);
    const info = await stat(file);
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      warn(`${providerID}: key file ${source.file} is readable by others; run chmod 600`);
    }
    return (await readFile(file, "utf8")).trim();
  }
  if ("command" in source) {
    const [file, ...args] = source.command;
    if (!file) return undefined;
    return run(file, args, COMMAND_TIMEOUT_MS);
  }
  const options = source.keyring === true ? {} : source.keyring;
  const command = keyringCommand(
    options.service ?? KEYRING_SERVICE,
    options.account ?? providerID
  );
  if (!command) return undefined;
  return run(command[0], command[1], COMMAND_TIMEOUT_MS);
};

/** Tries each source in order and returns the first non-empty value. */
export const resolveSecret = async (
  sources: readonly SecretSource[],
  providerID: string,
  options: {
    readonly run?: CommandRunner;
    readonly warn?: (message: string) => void;
  } = {}
): Promise<ResolvedSecret | undefined> => {
  const run = options.run ?? runCommand;
  const warn = options.warn ?? (() => {});
  for (const source of sources) {
    try {
      const value = (await readOne(source, providerID, run, warn))?.trim();
      if (value) return { value, origin: describe(source) };
    } catch {
      // A missing tool, file or entry just means this source has nothing; try the next.
    }
  }
  return undefined;
};
