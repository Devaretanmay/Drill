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

[![npm version](https://img.shields.io/npm/v/drill-log?color=7C3AED&style=flat-square)](https://www.npmjs.com/package/drill-log)
[![License: BUSL-1.1](https://img.shields.io/badge/license-BUSL--1.1-7C3AED?style=flat-square)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/anomalyco/drill/ci.yml?color=7C3AED&style=flat-square&label=CI)](https://github.com/anomalyco/drill/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-7C3AED?style=flat-square)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D18-7C3AED?style=flat-square)](https://nodejs.org)

</div>

---

## What it does

You're in the terminal. Something broke. You have logs.

Instead of googling the error, pasting it into ChatGPT, or scrolling through 800 lines manually — pipe the log into Drill. In under 60 seconds you get a plain-English root cause, a specific fix, and the exact evidence lines. All inside the terminal you're already in.

```
docker logs my-api 2>&1 | drill --git-diff

  Reading 847 lines...
  git: abc1234 · 3 files changed

  ▸ examining PostgreSQL connection exhaustion pattern
  ▸ temporal correlation — all services fail at 14:07:33
  ▸ UserService.java changed in this commit — possible cause

┌─ DRILL ──────────────────────────── Confidence: 91% ─┐
│                                                           │
│  Cause:    PostgreSQL max_connections limit reached     │
│            — 100/100 connections in use at 14:07:33     │
│  Severity: HIGH                                          │
│                                                           │
│  Fix:      Increase max_connections in postgresql.conf   │
│            from 100 to 200, or add PgBouncer             │
│                                                           │
│  Evidence: › "remaining connection slots reserved"      │
│            › UserService.java changed null → client.init │
│                                                           │
└───────────────────────────────────────────────────────────┘
  drill · minimax · 1.2s
```

Drill does not run its own AI. It uses whatever LLM provider you already have — OpenAI, Anthropic, Groq, Mistral, or a local model via Ollama. You bring the key. Drill handles the rest.

---

## Install

```bash
npm install -g drill-log
```

Requires Node.js 18 or higher. Works on macOS, Linux, and Windows (WSL).

---

## Quick start

```bash
# 1. Configure your LLM provider
drill setup

# 2. Analyze any log
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

# With source code context
cat error.log | drill --context ./src

# With git diff — Drill knows what changed
npm test 2>&1 | drill --git-diff

# With custom metadata
docker logs my-api | drill --meta "env=prod,deployed=10min ago"

# Everything combined
cat error.log | drill --context ./src --git-diff \
  --meta "branch=feature/payment"

# Watch a file and auto-analyze on errors
drill --watch /var/log/app.log

# CI mode — exits 1 on critical/high severity
cat build-failure.log | drill --ci

# Machine-readable output
cat error.log | drill --json | jq .cause

# Local Ollama model (nothing sent to API)
echo "ERROR: OOM" | drill --local --model qwen2.5:1.5b

# Verbose mode — show redaction stats and timing
cat error.log | drill --verbose
```

---

## Commands

| Command | Description |
|---|---|
| `drill [input]` | Analyze inline log text |
| `drill setup` | Configure your LLM provider (interactive wizard) |
| `drill logout` | Clear your stored configuration |
| `drill config list` | Show all configuration values |
| `drill config get <key>` | Get a single config value |
| `drill config set <key> <value>` | Set a config value |

---

## Flags

| Flag | Description |
|---|---|
| `--no-redact` | Disable PII redaction (use only for non-sensitive logs) |
| `--lines <n>` | Analyze only the last N lines of input |
| `--context <dir>` | Add source code context from directory |
| `--git-diff` | Include git diff of the last commit in diagnosis |
| `--meta <text>` | Additional context: env, config, branch, deploy info |
| `--json` | Output raw JSON result to stdout |
| `--ci` | Exit code 1 on critical/high severity |
| `--watch <file>` | Watch a file for errors and auto-analyze |
| `--local` | Use local Ollama model (nothing sent to API) |
| `--model <name>` | Local model name when using --local |
| `--verbose` | Show redaction stats, timing, and debug info |
| `--timeout <n>` | Request timeout in seconds |

---

## Providers

Drill works with any of these. Run `drill setup` to configure interactively.

| Provider | Env variable |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| Ollama (local) | none |
| Custom endpoint | `CUSTOM_API_KEY` |

After entering your API key, `drill setup` fetches the available models from that provider and shows a numbered list to choose from.

---

## Privacy

PII redaction runs before any data leaves your machine. 14 pattern categories stripped from every log before it reaches the LLM:

emails · IPv4/IPv6 addresses · API keys · Bearer tokens · AWS credentials · JWT tokens · SSH private keys · DSN connection strings · passwords in key=value pairs · UUIDs · Basic auth headers · credit card numbers · phone numbers

Use `--no-redact` only if your logs contain no sensitive data. Log content is **never stored** anywhere.

---

## How it works

```
stdin / inline arg
      │
      ▼
  redact.ts      →  strip 14 PII patterns — before anything leaves the binary
      │
      ▼
  dedup.ts      →  collapse repeated log lines
      │
      ▼
  filter.ts     →  extract ERROR/FATAL lines + context window
      │
      ▼
  chunk.ts      →  smart truncation for large logs
      │
      ▼
  context.ts    →  walk source dir, score files by stack trace keywords
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
  render.ts     →  styled terminal output
```

---

## Development

```bash
# Clone
git clone https://github.com/anomalyco/drill
cd drill

# Install dependencies
pnpm install

# Run tests
pnpm --filter drill-log test

# Check coverage
pnpm --filter drill-log test:coverage

# Type check
pnpm --filter drill-log typecheck

# Build binary
pnpm --filter drill-log build

# Run locally
echo "Error: ECONNREFUSED" | node packages/cli/dist/index.js
```

Requirements: Node.js 18+, pnpm 9+.

---

## Contributing

Issues and pull requests welcome.

Before submitting a PR, all of these must pass with zero errors:

```bash
pnpm --filter drill-log typecheck
pnpm --filter drill-log lint
pnpm --filter drill-log test
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
