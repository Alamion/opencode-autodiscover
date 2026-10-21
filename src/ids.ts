/**
 * Catalog ids are what users see and type (`provider/<id>`); the raw id goes to the endpoint
 * untouched as `modelID`. OpenCode splits a reference at the first `/` and at `#` (variant), so
 * the catalog id must not contain `#`, and backslashes are folded into `/` so `local\qwen`
 * and `local/qwen` read the same way in the UI.
 */
export const toCatalogId = (rawId: string): string => {
  const id = rawId
    .replaceAll("\\", "/")
    .replaceAll(/[#\s]+/gu, "-")
    .replaceAll(/\/{2,}/gu, "/")
    .replaceAll(/^\/+|\/+$/gu, "");
  return id.length > 0 ? id : "model";
};

/** Maps raw ids to unique catalog ids; collisions get a stable `-2`, `-3`… suffix. */
export const assignCatalogIds = (rawIds: readonly string[]): Map<string, string> => {
  const result = new Map<string, string>();
  const taken = new Set<string>();
  for (const rawId of [...new Set(rawIds)].toSorted()) {
    const base = toCatalogId(rawId);
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    result.set(rawId, id);
  }
  return result;
};
