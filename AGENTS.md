# Drill — AI-powered log diagnosis CLI

## What this project is

Drill is a production-grade CLI tool, Node/Python SDK, and GitHub Action that takes any log stream or error message, sends it to MiniMax M2.5 via a managed API, and returns a plain-English root cause with confidence score, severity, fix suggestion, and evidence — streamed live to the terminal in under 60 seconds.

**This is not an MVP. Every feature is built completely, tested, typed, and production-ready. No stubs, no TODO comments, no "implement later" placeholders.**

## Stack — non-negotiable

- **CLI binary**: TypeScript, compiled with `esbuild` to a standalone Node.js bundle
- **API backend**: Next.js 15 App Router, Vercel serverless, TypeScript strict mode
- **Database**: Supabase Postgres with Row Level Security enabled on every table
- **Auth**: Clerk (magic link + Google OAuth)
- **Billing**: Stripe (usage-metered, webhooks)
- **LLM**: MiniMax M2.5 via `https://api.minimax.io/v1/chat/completions` — OpenAI-compatible
- **Fallback LLM**: Together AI `MiniMaxAI/MiniMax-M2.5` on any 5xx or timeout from primary
- **Packages**: pnpm workspaces monorepo — `packages/cli`, `packages/sdk`, `packages/web`, `packages/action`

## Monorepo structure

```
drill/
  packages/
    cli/          # drill-cli npm package
    sdk/          # drill-sdk npm package (Node + Python)
    web/          # drill.dev Next.js site
    action/       # drill/action GitHub Action
  specs/          # Read these before building each domain
    SPEC_CLI.md
    SPEC_API.md
    SPEC_SDK.md
    SPEC_WEB.md
    SPEC_DATABASE.md
    SPEC_PROMPTS.md
    SPEC_TESTING.md
  AGENTS.md       # This file
```

## Critical rules — always followed

1. **TypeScript strict mode everywhere.** `"strict": true` in every tsconfig. No `any`. No `as unknown as X` casts without a comment explaining why.
2. **Every function has a return type annotation.** No implicit `any` returns.
3. **All errors are typed.** Never `catch (e: any)`. Always `catch (e: unknown)` with `instanceof` narrowing.
4. **No TODO or FIXME in committed code.** If something needs doing, do it now or create a GitHub issue reference.
5. **Every exported function has a JSDoc comment** with `@param`, `@returns`, `@throws` where applicable.
6. **Tests are written alongside implementation, not after.** Vitest for unit tests. Playwright for e2e. Min 80% coverage enforced by CI.
7. **No secrets in code.** All secrets via environment variables. `process.env.X` always validated at startup with a typed env validator (use `zod`).
8. **Streaming is non-negotiable.** Every LLM call uses `stream: true`. SSE proxied directly to client. No buffering full responses.
9. **M2.5 `<think>` tags must be preserved in conversation history.** Never strip them before storing or passing back.
10. **PII redaction runs before any data leaves the binary.** The `redact()` function is called in `run.ts` before `api.ts` is ever invoked.

## Before building any domain

Read the corresponding spec file first:
- CLI work → read `@specs/SPEC_CLI.md`
- API/backend work → read `@specs/SPEC_API.md`
- SDK work → read `@specs/SPEC_SDK.md`
- Web/frontend work → read `@specs/SPEC_WEB.md`
- Database work → read `@specs/SPEC_DATABASE.md`
- Prompt engineering → read `@specs/SPEC_PROMPTS.md`
- Testing → read `@specs/SPEC_TESTING.md`

## Environment variables (all required at startup)

```
# packages/web (Vercel)
MINIMAX_API_KEY=          # Primary LLM
TOGETHER_API_KEY=         # Fallback LLM
SUPABASE_URL=
SUPABASE_SERVICE_KEY=     # Server-side only, never exposed to client
SUPABASE_ANON_KEY=        # Client-side safe
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=

# packages/cli (runtime, from ~/.drill/config)
DRILL_API_KEY=            # Set by `drill login`
DRILL_API_URL=            # Default: https://drill.dev — overridable for self-host
```

## Code quality gates (CI enforces all)

```
pnpm typecheck   # tsc --noEmit across all packages
pnpm lint        # ESLint + biome
pnpm test        # vitest run
pnpm test:e2e    # playwright test
pnpm build       # must succeed with zero warnings
```

## Commit convention

`type(scope): description` — types: feat, fix, test, refactor, docs, ci, chore
