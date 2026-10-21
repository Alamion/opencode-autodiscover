# Agents Configuration

## Project Overview

**opencode-autodiscover** is an OpenCode v2 plugin (`@opencode/plugin` promise API). It polls
OpenAI-compatible endpoints, enriches each model from LiteLLM `/model/info`, the models.dev
catalog already loaded into OpenCode, and OpenRouter, and registers the result through
`ctx.provider.transform`. Keys come from the OS keyring/env/command/file and are attached by a
`session.hook("model.request")`.

## Commands

- **Test**: `npm test` (Vitest) · Watch: `npm run test:watch`
- **Typecheck**: `npm run typecheck`
- No build: OpenCode loads `index.ts` with Bun. Local manual testing: point `plugins[].package`
  at the checkout and run `opencode models --standalone` with `XDG_CONFIG_HOME`/`XDG_CACHE_HOME`
  set to a scratch directory so the real config is untouched.

## Architecture

- `index.ts` — entry (`exports["./server"]`), re-exports the default plugin
- `src/plugin.ts` — `setup`: options → endpoint states → provider transform, request hook, refresh loop
- `src/options.ts` — parses plugin options (`providers` map, legacy `endpoints` array), default key sources
- `src/secrets.ts` — key sources: keyring (`secret-tool` / `security`), env, command, file
- `src/discovery.ts` — `/models` and LiteLLM `/model/info` parsing
- `src/matching.ts` — finds models.dev templates (from the provider editor) and OpenRouter entries
- `src/build.ts` — merges sources into `Model.Info`; precedence lives here
- `src/naming.ts` — readable names, group labels, `matchKey` normalization
- `src/ids.ts` — catalog id (UI) vs raw id (`modelID`, sent upstream)
- `src/openrouter.ts`, `src/cache.ts`, `src/log.ts` — disk cache and file log
- `src/types.ts` — shared types

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`; never `any`
- `effect` and `@opencode/plugin` are provided by the host at runtime: type-only imports, never bundle
- Never log or cache secrets; pass known secrets to `sanitizeErrorMessage`
- Costs are USD per 1M tokens everywhere inside the plugin
- Tests cover observable behaviour in `tests/`; caches go to temp dirs via `cacheDir`
- Conventional commits; user-visible changes go to `.github/CHANGELOG.md` and `README.md`
