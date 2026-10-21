# Porting an OpenCode 1.x plugin to 2.x

Notes from porting this plugin, based on the OpenCode v2.1.2 sources (`packages/plugin/src/promise`,
`packages/core/src/plugin`, `specs/v2`). The public docs at opencode.ai/docs/plugins still describe 1.x.

## Module shape

| 1.x | 2.x |
| --- | --- |
| `@opencode-ai/plugin` | `@opencode/plugin` (provided by the host at runtime, like `effect` — do not bundle) |
| any named export `async (ctx) => hooks` | **default** export `{ id, setup }` (Promise API) or `{ id, effect }` (Effect API) |
| `ctx.client`, `ctx.$`, `ctx.project`, `ctx.directory` | `ctx.location`, `ctx.app`, `ctx.options` and one object per domain |
| hooks object returned | hooks registered imperatively inside `setup`; `setup` may return a cleanup function |

A 1.x module fails to load with *Plugin must export a default definition with an id and an effect
or setup function*.

## Loading and options

- Config key `plugins` (1.x `plugin` is migrated). Entries: `"name"`, `"-name"` (remove), or
  `{ "package": "name-or-path", "options": { … } }`; options arrive as `ctx.options`.
- Local plugins are **directories** (absolute, `file://`, or `./` relative to the config file); the
  entry is `server.ts` or `index.ts`. Their files are watched and hot-reloaded.
- npm packages expose `exports["./server"]` (and optionally `"./tui"`, `"./rpc"`).
- TypeScript runs directly under Bun; a build step is optional.

## Hooks → domains

| 1.x | 2.x |
| --- | --- |
| `config` hook mutating providers/models | `ctx.provider.transform(editor => …)` / `ctx.model.transform` |
| `config` hook for agents, commands, MCP | `ctx.agent` / `ctx.command` / `ctx.mcp` / `ctx.skill` `.transform` |
| `tool: { x: tool({ args: zod }) }` | `ctx.tool.transform(t => t.add({ name, description, input: Schema, output, execute }))` (Effect Schema) |
| `chat.params`, `chat.headers` | `ctx.session.hook("model.request")` (headers, baseURL), `"context"` (system, messages, tools) |
| `tool.execute.before/after` | `ctx.session.hook("context")` to edit tools; `ctx.tool.transform` to wrap them |
| `event` hook | `ctx.event.subscribe()` |
| `client.app.log` | none; console output is not shown — log to a file |

Transforms are **replayed**: OpenCode re-runs every transform to rebuild a domain. The editor
callback is synchronous, so load async data first, keep it in a variable, and call
`ctx.<domain>.reload()` when it changes. Unregistering (plugin removed) needs no undo code.

Runtime hooks take `{ providerID }` to scope them to one provider.

## Providers and models

- Provider: `{ id, name, activation: "auto" | "enabled" | "disabled", package, settings, headers, integrationID }`.
  `package` is a native specifier such as `@opencode/ai/providers/openai-compatible`; a provider
  without one fails with *Unsupported package*. A 1.x provider with no `npm` therefore breaks.
- `settings` replaces 1.x `options` (`baseURL`, `apiKey`, timeouts…). In migrated 1.x config the
  provider field `api` becomes `settings.baseURL`, so `"api": "openai"` turns into a bogus URL.
- Model: `id` (catalog key, what users type after `provider/`) is separate from `modelID` (sent upstream).
  References split at the first `/` and at `#` (variant), so `id` must not contain `#`.
- `cost` is an array of tiers in **USD per 1M tokens** with `cache.read/write`; LiteLLM reports per token.
- `capabilities: { tools, input[], output[], temperature? }`, `limit: { context, output, input? }`,
  `variants: [{ id, settings?, headers?, body? }]` — for OpenAI-compatible endpoints a reasoning
  variant is `{ id: "high", settings: { reasoningEffort: "high" } }`.
- `editor.list()` inside `provider.transform` also returns the models.dev providers loaded by
  OpenCode itself, which makes a free metadata source.
- Credentials live in OpenCode's database and are injected per request; plugins cannot read them
  (`ctx.credential` only has `activate`).
