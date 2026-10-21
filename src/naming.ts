const BRANDS: Readonly<Record<string, string>> = {
  claude: "Claude",
  codestral: "Codestral",
  deepseek: "DeepSeek",
  ernie: "ERNIE",
  flashx: "FlashX",
  gemini: "Gemini",
  gemma: "Gemma",
  glm: "GLM",
  gpt: "GPT",
  granite: "Granite",
  grok: "Grok",
  hunyuan: "Hunyuan",
  internlm: "InternLM",
  kimi: "Kimi",
  llama: "Llama",
  minimax: "MiniMax",
  mistral: "Mistral",
  mixtral: "Mixtral",
  nemotron: "Nemotron",
  olmo: "OLMo",
  phi: "Phi",
  qwen: "Qwen",
  qwq: "QwQ",
  smollm: "SmolLM",
};

/** Brands written with a hyphen before the version: GPT-5, GLM-4.6. */
const HYPHENATED = new Set(["GPT", "GLM"]);

const UPPERCASE = new Set([
  "awq", "bf16", "exl2", "fp16", "fp8", "gguf", "gptq", "int4", "int8", "mlx", "moe", "nvfp4", "oss", "vl",
]);

const GROUP_LABELS: Readonly<Record<string, string>> = {
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  azure: "Azure",
  bedrock: "Bedrock",
  deepseek: "DeepSeek",
  google: "Google",
  local: "local",
  mistral: "Mistral",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  vertex: "Vertex",
  xai: "xAI",
  zai: "Z.ai",
};

const capitalize = (word: string): string =>
  word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);

const formatToken = (token: string): string => {
  const lower = token.toLowerCase();
  const brand = BRANDS[lower];
  if (brand) return brand;
  if (UPPERCASE.has(lower)) return lower.toUpperCase();
  // Parameter counts and active-expert sizes: 122b → 122B, a10b → A10B, 8x7b → 8x7B.
  const size = /^(a?)(\d+(?:x\d+)?(?:\.\d+)?)([bmkt])$/u.exec(lower);
  if (size) return `${size[1]!.toUpperCase()}${size[2]}${size[3]!.toUpperCase()}`;
  // Brand glued to its version: qwen3.5 → Qwen3.5, deepseek-v3 stays split by the caller.
  const glued = /^([a-z]+)(\d[\d.]*)(.*)$/u.exec(lower);
  if (glued && BRANDS[glued[1]!]) return `${BRANDS[glued[1]!]}${glued[2]}${glued[3]}`;
  // OpenAI's o-series is written lowercase: o3, o4-mini.
  if (/^o\d+$/u.test(lower)) return lower;
  // Short version tags: v3 → V3, r1 → R1, k2 → K2.
  if (/^[a-z]\d+(?:\.\d+)?$/u.test(lower)) return lower.toUpperCase();
  if (/^\d/u.test(token) || token !== lower) return token;
  return capitalize(lower);
};

/** Turns the last segment of a model id into a readable name: `qwen3.5-122b-a10b` → `Qwen3.5 122B A10B`. */
export const prettifyModelName = (rawId: string): string => {
  const last = rawId.replaceAll("\\", "/").split("/").at(-1) ?? rawId;
  const tokens = last
    .replace(/^~/u, "")
    .split(/[-_\s:]+/u)
    .filter((token) => token.length > 0)
    .map(formatToken);
  let name = "";
  for (const token of tokens) {
    const previous = name.split(" ").at(-1) ?? "";
    name += name.length === 0 ? token : HYPHENATED.has(previous) && /^\d/u.test(token) ? `-${token}` : ` ${token}`;
  }
  return name.length > 0 ? name : rawId;
};

/** First path segment of a namespaced id (`local/qwen` → `local`), if any. */
export const groupOf = (rawId: string): string | undefined => {
  const segments = rawId.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : undefined;
};

export const groupLabel = (
  group: string | undefined,
  overrides: Readonly<Record<string, string | false>>
): string | undefined => {
  if (!group) return undefined;
  const override = overrides[group];
  if (override === false) return undefined;
  if (typeof override === "string") return override.length > 0 ? override : undefined;
  return GROUP_LABELS[group.toLowerCase()] ?? capitalize(group);
};

export const withGroup = (name: string, label: string | undefined): string =>
  label && !name.toLowerCase().endsWith(`(${label.toLowerCase()})`) ? `${name} (${label})` : name;

/** Key used to compare ids across sources: last segment, lowercased, separators unified. */
export const matchKey = (id: string): string =>
  (id.replaceAll("\\", "/").split("/").at(-1) ?? id)
    .toLowerCase()
    .replace(/^~/u, "")
    .replaceAll(/[\s:_.]+/gu, "-")
    .replaceAll(/-{2,}/gu, "-");
