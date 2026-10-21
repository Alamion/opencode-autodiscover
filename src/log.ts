import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

const MAX_BYTES = 512 * 1024;

/**
 * OpenCode does not surface plugin console output, so lines also go to a small rotating
 * file next to the cache. Messages must already be free of secrets.
 */
export const createFileLogger = (dir: string, prefix: string): Logger => {
  const file = path.join(dir, "autodiscover.log");
  let queue = Promise.resolve();
  const write = (level: string, message: string) => {
    const line = `${new Date().toISOString()} ${level} ${message}\n`;
    queue = queue
      .then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const size = await stat(file).then((info) => info.size, () => 0);
        if (size > MAX_BYTES) await rename(file, `${file}.1`);
        await appendFile(file, line, { mode: 0o600 });
      })
      .catch(() => {});
  };
  return {
    info: (message) => {
      write("INFO", message);
      console.info(`[${prefix}] ${message}`);
    },
    warn: (message) => {
      write("WARN", message);
      console.warn(`[${prefix}] ${message}`);
    },
  };
};
