const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replaceAll(/[.+^${}()|[\]\\?]/gu, "\\$&");
  return new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "iu");
};

/** `include` narrows first, `exclude` then removes; `*` matches across `/`. */
export const matchesFilter = (
  modelId: string,
  include: readonly string[],
  exclude: readonly string[]
): boolean => {
  if (include.length > 0 && !include.some((p) => globToRegex(p).test(modelId))) {
    return false;
  }
  return !exclude.some((p) => globToRegex(p).test(modelId));
};
