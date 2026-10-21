const VALID_PROTOCOLS = new Set(["http:", "https:"]);

export const isValidUrl = (url: string): boolean => {
  try {
    return VALID_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** Removes anything that looks like a credential from text bound for logs. */
export const sanitizeErrorMessage = (error: unknown, secrets: readonly string[] = []): string => {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.replaceAll(secret, "[REDACTED]");
  }
  return message
    .replaceAll(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .replaceAll(/api[_-]?key[=:]\s*[^\s&]+/giu, "api_key=[REDACTED]")
    .replaceAll(/sk-[\w-]+/gu, "sk-[REDACTED]");
};
