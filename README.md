<div align="center">

<pre>
██████╗  ██████╗  ██╗ ██╗      ██╗     
██╔══██╗ ██╔══██╗ ██║ ██║      ██║     
██║  ██║ ██████╔╝ ██║ ██║      ██║     
██║  ██║ ██╔══██╗ ██║ ██║      ██║     
██████╔╝ ██║  ██║ ██║ ███████╗ ███████╗
╚═════╝  ╚═╝  ╚═╝ ╚═╝ ╚══════╝ ╚══════╝
</pre>

**Pipe any log. Get the root cause.**

[![npm version](https://img.shields.io/npm/v/drill-cli?color=7C3AED&style=flat-square)](https://www.npmjs.com/package/drill-cli)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-7C3AED?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/drill-dev/drill/ci.yml?color=7C3AED&style=flat-square&label=CI)](https://github.com/drill-dev/drill/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-7C3AED?style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D18-7C3AED?style=flat-square)](https://nodejs.org)

</div>

---

## What it does

You're in the terminal. Something broke. You have logs.

Instead of googling the error, pasting it into ChatGPT, or scrolling through 800 lines manually — you pipe the log into Drill. In under 60 seconds you get a plain-English root cause, a specific fix, and the exact evidence lines that led to the diagnosis. All inside the terminal you're already in.

```
docker logs my-api 2>&1 | drill

  Reading 847 lines...
  ▸ examining connection pool exhaustion pattern
  ▸ temporal correlation — all services fail at 14:07:33
  ▸ cross-referencing max_connections threshold

┌─ DRILL ──────────────────────────── Confidence: 91% ─┐
│                                                       │
│  Cause:    PostgreSQL max_connections limit reached   │
│  Severity: 🟠 HIGH                                   │
│                                                       │
│  Fix:      Increase max_connections in               │
│            postgresql.conf from 100 to 200, or       │
│            add PgBouncer as a connection pooler       │
│                                                       │
│  Evidence: › "remaining connection slots reserved"    │
│            › all services fail at identical timestamp │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Drill does not run its own AI. It uses whatever LLM provider you already have — OpenAI, Anthropic, Groq, Mistral, or a local model via Ollama. You bring the key. Drill handles the rest.

---

## Install

```bash
npm install -g drill-cli
```

Requires Node.js 18 or higher. Works on macOS, Linux, and Windows (WSL).

---

## Quick start

```bash
# 1. Configure your LLM provider
drill setup

# 2. Create your free account
drill login

# 3. Analyze any log
docker logs my-api 2>&1 | drill
```

`drill setup` walks you through choosing a provider and entering your API key. Takes 2 minutes. If you don't have an API key, [Groq has a free tier](https://console.groq.com) — no credit card needed.

---

## Usage

```bash
# Pipe any log source
docker logs my-api 2>&1 | drill
kubectl logs my-pod --previous | drill
cat error.log | drill
npm run build 2>&1 | drill

# Inline text
drill "NullPointerException at UserService.java:42"

# Last N lines only
tail -100 /var/log/app.log | drill

# Add source code context
cat error.log | drill --context ./src

# Watch a file and auto-analyze on errors
drill --watch /var/log/app.log

# CI mode — exits 1 if cause found (confidence >= 50%)
cat build-failure.log | drill --ci

# Machine-readable output
cat error.log | drill --json | jq .cause
```

---

## Commands

| Command | Description |
|---|---|
| `drill [input]` | Analyze inline log text |
| `drill login` | Authenticate via magic link (no password) |
| `drill logout` | Sign out and clear stored credentials |
| `drill status` | Show plan, weekly usage, and provider |
| `drill setup` | Configure LLM provider interactively |
| `drill config list` | Show all configuration values |
| `drill config get <key>` | Get a single config value |
| `drill config set <key>=<val>` | Set a config value |

---

## Flags

| Flag | Description |
|---|---|
| `--no-redact` | Disable PII redaction |
| `--lines <n>` | Analyze only last N lines |
| `--context <dir>` | Include source code context |
| `--json` | Output raw JSON to stdout |
| `--ci` | Exit code 1 if cause found |
| `--watch <file>` | Auto-analyze on error patterns |
| `--local` | Use local Ollama model |
| `--model <name>` | Specify local model name |
| `--verbose` | Show redaction stats and timing |
| `--timeout <n>` | Request timeout in seconds |

---

## Providers

Drill works with any of these. Run `drill setup` to configure interactively.

| Provider | Env variable | Recommended model | Free tier |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `gpt-4o` | — |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5` | — |
| Groq | `GROQ_API_KEY` | `llama-3.1-70b-versatile` | ✓ |
| Mistral | `MISTRAL_API_KEY` | `mistral-large` | — |
| MiniMax | `MINIMAX_API_KEY` | `MiniMax-M2.5` | — |
| Together AI | `TOGETHER_API_KEY` | `MiniMaxAI/MiniMax-M2.5` | — |
| Ollama (local) | none needed | `qwen2.5-coder:7b` | ✓ fully local |
| Custom endpoint | `CUSTOM_API_KEY` | any OpenAI-compatible | — |

> **No API key?** Groq offers a generous free tier. Sign up at [console.groq.com](https://console.groq.com) in 2 minutes.

---

## Privacy

PII redaction runs before any data leaves your machine. 13 pattern categories stripped from every log before it reaches the LLM:

emails · IPv4/IPv6 addresses · API keys · Bearer tokens · AWS credentials · JWT tokens · SSH private keys · DSN connection strings · passwords in key=value pairs · UUIDs · Basic auth headers · credit card numbers · phone numbers

Use `--no-redact` only if your logs contain no sensitive data.

Log content is **never stored**. Drill only records your run count and account metadata.

---

## Free vs Pro

| | Free | Pro *(coming soon)* |
|---|---|---|
| Analyses | 100 / week | Unlimited |
| All providers (own key) | ✓ | ✓ |
| All models | ✓ | ✓ |
| PII redaction | ✓ | ✓ |
| `--watch` mode | ✓ | ✓ |
| `--context` flag | ✓ | ✓ |
| `--ci` flag | ✓ | ✓ |
| Result history | — | ✓ 30 days |
| Team seats | — | ✓ 5 seats |
| GitHub Action | — | ✓ |
| Node + Python SDK | — | ✓ |
| Custom system prompt | — | ✓ |
| Priority support | — | ✓ |

> **Pro is coming soon.** Free tier stays free. We'll announce pricing once we reach 500 users.

---

## How it works

```
stdin / inline arg
      │
      ▼
 context.ts    →  walk source dir, score files by stack trace keywords
      │
      ▼
 redact.ts     →  strip 13 PII patterns — before anything leaves the binary
      │
      ▼
 chunk.ts      →  smart truncation for logs up to 100MB
      │
      ▼
 prompts.ts    →  system prompt + type detection (Python, OOM, CI, general)
      │
      ▼
 providers.ts  →  route to configured LLM provider
      │
      ▼
 stream.ts     →  SSE parser — <think> tags stream live, result buffered
      │
      ▼
 prompts.ts    →  Zod schema validation, parse retry on failure
      │
      ▼
 render.ts     →  boxen result box in terminal
```

---

## Development

```bash
# Clone
git clone https://github.com/drill-dev/drill
cd drill

# Install dependencies
pnpm install

# Run tests
pnpm --filter cli test

# Check coverage
pnpm --filter cli test:coverage

# Type check
pnpm typecheck

# Build binary
pnpm --filter cli build

# Run locally
echo "Error: ECONNREFUSED" | node packages/cli/dist/index.js
```

Requirements: Node.js 18+, pnpm 9+.

---

## Contributing

Issues and pull requests welcome.

Before submitting a PR, both of these must pass with zero errors:

```bash
pnpm typecheck
pnpm test
```

---

## License

Source-available under [Business Source License 1.1](./LICENSE).

Free for personal use, internal business use, and open source projects.  
Commercial hosting or resale requires a separate license.  
Converts to MIT on 2029-01-01.

---

<div align="center">

Made by developers who got tired of googling error messages.

</div>
