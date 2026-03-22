# Drill — AI-powered log diagnosis CLI

## What this project is

Drill is a standalone CLI tool that takes any log stream or error message, sends it to an LLM, and returns a plain-English root cause with confidence score, severity, fix suggestion, and evidence — streamed live to the terminal in under 60 seconds.

**This is not an MVP. Every feature is built completely, tested, typed, and production-ready. No stubs, no TODO comments, no "implement later" placeholders.**

## Architecture

The CLI calls LLM providers directly via the adapter pattern in `providers.ts`. It does NOT call a managed backend API. There is no backend, no database, no billing.

## Stack — non-negotiable

- **CLI binary**: TypeScript, compiled with `esbuild` to a standalone Node.js bundle
- **LLM**: MiniMax M2.5 by default, plus OpenAI, Anthropic, Groq, Mistral, Ollama, Together AI, or any OpenAI-compatible endpoint
- **Config**: JSON file at `~/.drill/config` via `conf` package
- **No backend**: drill has no server, no database, no billing
- **Packages**: `packages/cli` only (future: sdk, web, action — see WorkFlow/future/)

## Monorepo structure

```
drill/
  packages/
    cli/          # drill-cli npm package (CURRENT SCOPE)
    # sdk, web, action — FUTURE SCOPE (see WorkFlow/future/)
  specs/
    SPEC_CLI.md
  WorkFlow/
    current/      # Active phases (1-5)
    future/       # Future phases (6-10)
  AGENTS.md       # This file
```

## Critical rules — always followed

1. **TypeScript strict mode everywhere.** `"strict": true` in every tsconfig. No `any`. No `as unknown as X` casts without a comment explaining why.
2. **Every function has a return type annotation.** No implicit `any` returns.
3. **All errors are typed.** Never `catch (e: any)`. Always `catch (e: unknown)` with `instanceof` narrowing.
4. **No TODO or FIXME in committed code.** If something needs doing, do it now or create a GitHub issue reference.
5. **Every exported function has a JSDoc comment** with `@param`, `@returns`, `@throws` where applicable.
6. **Tests are written alongside implementation, not after.** Vitest for unit tests. Min 80% coverage enforced by CI.
7. **No secrets in code.** All secrets via environment variables.
8. **Streaming is non-negotiable.** Every LLM call uses `stream: true`. SSE proxied directly to client. No buffering full responses.
9. **PII redaction runs before any data leaves the binary.** The `redact()` function is called before `api.ts` is ever invoked.

## Supported LLM Providers

| Provider | API Key Env Var | Default Model |
|---|---|---|
| MiniMax | `MINIMAX_API_KEY` | `MiniMax-M2.5` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` |
| Groq | `GROQ_API_KEY` | `llama-3.1-70b-versatile` |
| Mistral | `MISTRAL_API_KEY` | `mistral-large` |
| Ollama | (none — local) | `llama3.2` |
| Together AI | `TOGETHER_API_KEY` | `MiniMaxAI/MiniMax-M2.5` |
| Custom | `CUSTOM_API_KEY` | any |

## Environment variables

```
# packages/cli
DRILL_API_KEY=           # Optional — stored in ~/.drill/config after setup
DRILL_API_URL=           # Optional — default: https://api.minimax.io/v1
```

## Code quality gates (CI enforces all)

```
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm test:coverage # vitest run --coverage (80% threshold on all tracked files)
pnpm build        # esbuild bundle
```

## Commit convention

`type(scope): description` — types: feat, fix, test, refactor, docs, ci, chore
