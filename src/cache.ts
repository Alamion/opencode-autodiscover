import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const readCache = async <T>(dir: string, name: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path.join(dir, name), "utf8")) as T;
  } catch {
    return undefined;
  }
};

/** Writes atomically so a crash mid-write never leaves a truncated cache behind. */
export const writeCache = async (dir: string, name: string, value: unknown): Promise<void> => {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, name);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, target);
  } catch {
    // The cache only speeds up startup; failing to write it is harmless.
  }
};

export const endpointCacheName = (providerID: string): string =>
  `endpoint-${providerID.replaceAll(/[^\w.-]/gu, "_")}.json`;
