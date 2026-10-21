# opencode-autodiscover

OpenCode **v2** plugin that discovers models from OpenAI-compatible endpoints — LiteLLM, vLLM,
Ollama, LM Studio, any `/v1/models` server — and registers them with prices, context limits,
capabilities and readable names.

- **Metadata, not just ids.** Prices, context/output limits, tool/vision/PDF support and reasoning
  effort variants come from LiteLLM's `/model/info`, the models.dev catalog OpenCode already
  loads, and OpenRouter's public list — no hand-written model blocks.
- **Keys out of config.** The API key is read from the OS keyring (or an env variable, a
  command, or a `0600` file) and attached to requests by a hook, so it never sits in
  `opencode.json` and never enters the provider catalog that OpenCode serves over its API.
- **Readable names.** `alibaba/qwen3.5-122b-a10b` shows as *Qwen3.5 122B-A10B (Alibaba)*,
  `local/qwen3.8-27b` as *Qwen3.8 27B (local)*.
- **Ids that resolve.** The id you pick in OpenCode and the id sent to the server are kept
  apart: `local\qwen3.8-27b` is listed as `local/qwen3.8-27b` but requested verbatim.
- **Stays fresh, survives outages.** Re-polls every 5 minutes; the last good result is cached
  on disk, so the model list is there at startup even if the endpoint is down.

Requires OpenCode 2.1 or newer. For OpenCode 1.x use `opencode-autodiscover@1`.

## Install

OpenCode installs the plugin straight from GitHub — add it to `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugins": [
    {
      "package": "github:Alamion/opencode-autodiscover#v3.0.0",
      "options": {
        "providers": {
          "litellm": {
            "name": "LiteLLM",
            "baseURL": "http://litellm.internal:4000/v1"
          }
        }
      }
    }
  ]
}
```

Pin a tag (`#v3.0.0`) to stay on a release; drop it to follow `main`. To hack on the plugin,
clone it and use the checkout's absolute path as `package` (a `file://…` URL or a path starting
with `./` relative to the config file also work) — local plugins reload when their files change.

Then store the key (next section) and run `opencode models` — the models appear as
`litellm/<id>`.

## API keys

Without an `apiKey` option the plugin tries, in order:

1. OS keyring entry `service=opencode-autodiscover`, `account=<provider id>`
2. `OPENCODE_AUTODISCOVER_<ID>_API_KEY`
3. `OPENCODE_LOCAL_<ID>_API_KEY` (1.x name)

Store the key in the keyring once:

```bash
# Linux (GNOME Keyring, KWallet — anything implementing the Secret Service API)
secret-tool store --label="opencode-autodiscover: litellm" service opencode-autodiscover account litellm

# macOS
security add-generic-password -s opencode-autodiscover -a litellm -w
```

Other sources, alone or as a fallback chain:

```jsonc
"apiKey": { "keyring": { "service": "litellm", "account": "work" } }
"apiKey": { "env": "LITELLM_API_KEY" }
"apiKey": { "command": ["pass", "show", "litellm/api-key"] }   // run without a shell
"apiKey": { "file": "~/.config/litellm.key" }                   // warns unless chmod 600
"apiKey": [{ "keyring": true }, { "env": "LITELLM_API_KEY" }]
"apiKey": false                                                  // endpoint needs no key
```

A literal string still works but is logged as a warning.

How the key is used: discovery requests send it directly; model requests get an
`Authorization: Bearer …` header from a `model.request` hook. Set `"keyDelivery": "settings"`
to store it as the provider's `apiKey` setting instead — only needed if another plugin must see
it, and note that OpenCode then returns it from its local model API.

After rotating the key in the keyring nothing needs restarting: a `401` makes the plugin
read the key again.

## Where metadata comes from

Highest priority first; each field takes the first source that has it.

| Source | Gives | Toggle |
| --- | --- | --- |
| `models` overrides in options | anything | — |
| `/models` of the endpoint | context (vLLM `max_model_len`, OpenRouter-style fields), display name | — |
| LiteLLM `/model/info` | prices incl. cache, context/output limits, tools, vision, PDF, reasoning, chat/embedding mode | `metadata.litellm` |
| models.dev (OpenCode's catalog) | curated name, family, release date, modalities, reasoning effort levels, prices | `metadata.catalog` |
| OpenRouter `/api/v1/models` | context, max output, prices, modalities | `metadata.openrouter` |
| defaults | 32k context, 8k output, tools on | — |

Prices are stored in USD per 1M tokens, the unit OpenCode uses (LiteLLM reports per token;
the plugin converts). Models LiteLLM marks as non-chat (embeddings, image, audio) are skipped.

Matching against models.dev uses LiteLLM's underlying model first (`dashscope/qwen3.8-max` →
the Alibaba catalog, `openrouter/anthropic/…` → OpenRouter), then the alias, then a
normalized name with quantization and `-latest` suffixes removed. The curated name is used only
when the alias names that exact model; an alias that points at another checkpoint keeps its own.

If an output limit equals the context window, it is halved so requests leave room for input.

## Names and groups

The first path segment of an id becomes a label: `local/…` → "(local)", `openrouter/…` →
"(OpenRouter)", unknown prefixes are capitalized. Change or hide them per prefix:

```jsonc
"groups": { "local": "GPU rack", "alibaba": false }
```

## All options

```jsonc
{
  "providers": {
    "<provider id>": {
      "baseURL": "http://host:4000/v1",       // required
      "name": "LiteLLM",                      // provider name in the UI
      "apiKey": { "keyring": true },          // see "API keys"
      "keyDelivery": "header",                // or "settings"
      "headers": { "X-Team": "platform" },    // sent on discovery and model requests
      "include": ["alibaba/*", "local/*"],    // globs over raw or catalog ids, case-insensitive
      "exclude": ["*preview*"],
      "metadata": { "litellm": true, "catalog": true, "openrouter": true },
      "groups": { "local": "GPU rack" },
      "models": {
        "local/qwen3.8-27b": {                // raw or catalog id
          "name": "Qwen 27B on the rack",
          "limit": { "context": 131072, "output": 32768 },
          "cost": { "input": 0, "output": 0 },   // USD per 1M tokens
          "tools": true,
          "vision": false,
          "reasoning": true,
          "efforts": ["low", "high"],         // variants, selected as model#low
          "disabled": false
        }
      }
    }
  },
  "refreshInterval": 300,                     // seconds, 0 = only at startup
  "timeout": 10000,                           // ms per HTTP request
  "cacheDir": "~/.cache/opencode-autodiscover"
}
```

Models declared for the same provider id in OpenCode's own `providers` config are kept; a
discovered model with the same id replaces its declared twin.

## Files

`~/.cache/opencode-autodiscover/` (or `$OPENCODE_AUTODISCOVER_CACHE_DIR`, or `cacheDir`):

- `endpoint-<id>.json` — last discovery result (no secrets)
- `openrouter.json` — OpenRouter list, refreshed daily
- `autodiscover.log` — plugin log; OpenCode does not show plugin console output

## Migrating

From **1.x** (OpenCode 1): move the provider from the top-level `provider` block into the
plugin's `options.providers`, drop hand-written `models`, remove `"plugin":
["opencode-autodiscover"]`, and move the key to the keyring. A v1 provider without `npm`
fails in OpenCode 2 with `Unsupported package`; this plugin sets the OpenAI-compatible
package itself.

From **2.0.x**: `options.endpoints` arrays still work. The TUI companion and the
`refresh-local-models` tool are gone; models refresh every `refreshInterval` seconds, and
editing a local plugin's files reloads it.

## Development

```bash
npm install
npm test
npm run typecheck
```

The plugin is plain TypeScript loaded by OpenCode's Bun runtime; there is no build step.
`effect` and `@opencode/plugin` are provided by OpenCode at runtime and are dev-only here.

## License

MIT
