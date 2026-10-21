# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-10-21

Rewritten against the released OpenCode 2.1 plugin API (`@opencode/plugin`).

### Added

- Prices (incl. cache read/write), limits, tool/vision/PDF/reasoning support from LiteLLM `/model/info`
- Metadata from the models.dev catalog already loaded in OpenCode, matched via LiteLLM's underlying model
- Reasoning effort variants (`model#low`, `#high`, …) for reasoning models
- Readable model names with route labels (`Qwen3.8 27B (local)`), configurable via `groups`
- API keys from the OS keyring, env, a command or a `0600` file; sent through a `model.request` hook
- Re-reading the key after a 401, periodic refresh, disk cache of the last discovery, file log
- Per-model overrides (`name`, `limit`, `cost`, `tools`, `vision`, `reasoning`, `efforts`, `disabled`)

### Changed

- Configuration lives in `options.providers` (map); the 2.0 `options.endpoints` array still works
- Catalog ids are separated from upstream ids: `local\qwen` is listed as `local/qwen`, requested verbatim
- Prices are converted from LiteLLM's per-token values to USD per 1M tokens

### Removed

- TUI companion, `refresh-local-models` tool, `models-dev-db` dependency, parsing of `opencode.json` by hand

## [2.0.2] - 2026-09-01

### Fixed

- TUI plugin: wrap keymap layer and slash command registration inside UI slot to ensure `<Keymap.Provider>` context is mounted
- Automatically auto-discover local endpoints directly from `provider` (v1) and `providers` (v2) blocks in `opencode.json(c)`
- Support `/v1/models` candidate probe when `baseURL` is specified without `/v1` suffix
- Deduplicate concurrent in-flight OpenRouter metadata fetches to eliminate startup timeouts

## [2.0.1] - 2026-09-01

### Added

- OpenCode v2 plugin API. `Plugin.define` with catalog and tool transforms
- OpenCode v2 CLI/TUI plugin companion export (`./tui`). Provides the `/refresh-models` slash command, command palette action, and toast notifications
- Plugin-owned endpoint configuration via `options.endpoints` (`id`, `baseURL`, `apiKey`, `headers`, `include`/`exclude`)
- Live catalog refresh via `catalog.reload()`. The `refresh-local-models` tool and `/refresh-models` CLI command update models without restarting OpenCode
- Zed editor settings (oxfmt formatting, oxlint linting, TS type checking)
- CI quality gate on push and pull requests, shared with the publish workflow
- Dependabot for npm and GitHub Actions dependencies

### Changed

- Configuration moved from v1 `provider` entries to the v2 `plugins` array
- `@opencode-ai/plugin` pinned to the `next` channel (v2 API)
- v2 releases publish under the `next` npm dist-tag while the OpenCode v2 plugin API is in beta; `latest` keeps tracking the v1 plugin
- Typecheck now covers `src` and `tests` through the root `tsconfig.json`

### Fixed

- `refresh-local-models` now clears the on-disk OpenRouter cache and replays the catalog immediately instead of serving a stale 24h cache
- OpenRouter requests time out after 10s instead of hanging the config hook
- Test caches are isolated to temp directories instead of the real user cache
