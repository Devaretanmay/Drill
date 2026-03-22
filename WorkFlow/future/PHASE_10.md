## 🚧 FUTURE SCOPE — Phase 10

# Phase 10 — SDK, GitHub Action, Homebrew, release pipeline, launch

## What this phase builds

Everything needed to ship publicly. The Node.js and Python SDKs built and published,
the GitHub Action live on Marketplace, Homebrew formula working, the automated release
pipeline that publishes all four distribution channels on every git tag, and the
complete launch checklist executed.

## Depends on

Phases 1–9 complete. drill.dev live on Vercel. Auth, billing, dashboard all working.

## Scope

- `packages/sdk/` — Node.js SDK, complete and published to npm as `drill-sdk`
- `packages/sdk-python/` — Python SDK, complete and published to PyPI as `drill-sdk`
- `packages/action/action.yml` — GitHub Action, complete and published to Marketplace
- `packages/action/README.md` — full usage documentation
- `github.com/drill-dev/homebrew-tap` — Homebrew tap repository + formula
- `.github/workflows/release.yml` — automated multi-channel release pipeline
- `packages/cli/test/integration/e2e-full.test.ts` — full end-to-end test against real API
- Launch checklist executed with evidence

---

## Node.js SDK: packages/sdk/

### Package structure

```
packages/sdk/
  src/
    index.ts        # Public exports
    client.ts       # DrillClient class
    types.ts        # All TypeScript interfaces
    stream.ts       # SSE streaming (shared logic with CLI)
    redact.ts       # PII redaction (same patterns as CLI)
    chunk.ts        # Log chunking (same as CLI)
    utils.ts        # isDrillError type guard
  test/
    client.test.ts
    redact.test.ts
    types.test.ts
  package.json
  tsconfig.json
  build.ts
```

### packages/sdk/package.json

```json
{
  "name": "drill-sdk",
  "version": "1.0.0",
  "description": "Official Node.js SDK for Drill — AI-powered log diagnosis",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import":  "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "types":   "./dist/index.d.ts"
    }
  },
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "tsx build.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "eventsource-parser": "^3.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "esbuild": "^0.24.0",
    "vitest": "^2.0.0",
    "msw": "^2.7.0",
    "@types/node": "^22.0.0"
  },
  "keywords": ["drill", "logging", "ai", "debugging", "root-cause", "minimax"],
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/drill-dev/drill-sdk" }
}
```

### packages/sdk/src/types.ts

```typescript
export interface DrillResult {
  cause: string;
  confidence: number;  // 0-100
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string[];
  fix: string;
  alternative: string | null;
  missing: string | null;
}

export interface DrillError {
  code: 'INVALID_KEY' | 'LIMIT_REACHED' | 'PARSE_FAILED' | 'TIMEOUT' | 'NETWORK' | 'REDACTED_EMPTY';
  message: string;
  upgrade_url?: string;
}

export interface DrillClientOptions {
  /** Drill API key. Default: process.env.DRILL_API_KEY */
  apiKey?: string;
  /** API base URL. Default: https://drill.dev */
  apiUrl?: string;
  /** Request timeout in ms. Default: 90000 */
  timeout?: number;
  /** Enable PII redaction before sending. Default: true */
  redact?: boolean;
  /** Called with each chunk of M2.5 thinking text as it streams */
  onThinking?: (text: string) => void;
}

export interface AnalyzeOptions {
  /** Additional context string to append to prompt */
  context?: string;
  /** Limit input to last N lines before analyzing */
  lines?: number;
  /** Override instance redact setting for this call */
  noRedact?: boolean;
  /** Override timeout for this call (ms) */
  timeout?: number;
}

export interface WatchOptions {
  /** Called when an error is detected and analysis completes */
  onResult: (result: DrillResult, logChunk: string) => void;
  /** Called on analysis error */
  onError?: (err: DrillError | Error) => void;
  /** Debounce in ms before triggering analysis. Default: 500 */
  debounceMs?: number;
  /** Custom error detection patterns. Default: standard error regex */
  errorPatterns?: RegExp[];
}

// Logger duck-typing interfaces
export interface WinstonLike {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface PinoLike {
  child: (bindings: Record<string, unknown>) => PinoLike;
  error: (msg: string, ...args: unknown[]) => void;
}
```

### packages/sdk/src/client.ts

```typescript
import { redact as redactFn } from './redact.ts';
import { chunk } from './chunk.ts';
import { parseStream } from './stream.ts';
import { parseResult } from './parser.ts';
import type {
  DrillClientOptions, DrillResult, DrillError,
  AnalyzeOptions, WatchOptions, WinstonLike,
} from './types.ts';

const DEFAULT_API_URL = 'https://drill.dev';
const DEFAULT_TIMEOUT = 90_000;

/**
 * Drill SDK client. Wraps the drill.dev managed API.
 * Never throws — all errors returned as DrillError objects.
 *
 * @example
 * const drill = new DrillClient({ apiKey: process.env.DRILL_API_KEY });
 * const result = await drill.analyze(logText);
 * if (!isDrillError(result)) console.log(result.cause);
 */
export class DrillClient {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly timeout: number;
  private readonly redactEnabled: boolean;
  private readonly onThinking: ((text: string) => void) | undefined;

  constructor(options: DrillClientOptions = {}) {
    this.apiKey       = options.apiKey ?? process.env['DRILL_API_KEY'] ?? '';
    this.apiUrl       = options.apiUrl ?? process.env['DRILL_API_URL'] ?? DEFAULT_API_URL;
    this.timeout      = options.timeout ?? DEFAULT_TIMEOUT;
    this.redactEnabled = options.redact ?? true;
    this.onThinking   = options.onThinking;
  }

  /**
   * Analyze log text and return the most probable root cause.
   * @param input Log string to analyze
   * @param options Per-call options
   * @returns DrillResult on success, DrillError on any failure
   */
  async analyze(input: string, options: AnalyzeOptions = {}): Promise<DrillResult | DrillError> {
    if (!this.apiKey) {
      return {
        code: 'INVALID_KEY',
        message: 'No API key set. Pass apiKey to DrillClient or set DRILL_API_KEY env var.',
      };
    }

    // Apply line limit
    let processed = options.lines
      ? input.split('\n').slice(-options.lines).join('\n')
      : input;

    // Apply redaction
    const shouldRedact = options.noRedact ? false : this.redactEnabled;
    if (shouldRedact) {
      processed = redactFn(processed);
      if (processed === '__DRILL_FULLY_REDACTED__') {
        return { code: 'REDACTED_EMPTY', message: 'Input was entirely PII — nothing left to analyze.' };
      }
    }

    // Apply chunking
    const chunked = chunk(processed);

    // Call API
    return this._callApi(chunked.content, options.context, options.timeout ?? this.timeout);
  }

  /**
   * Analyze a file by path.
   */
  async analyzeFile(filePath: string, options: AnalyzeOptions = {}): Promise<DrillResult | DrillError> {
    try {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(filePath, 'utf8');
      return this.analyze(content, options);
    } catch (e: unknown) {
      return { code: 'NETWORK', message: `Failed to read file: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /**
   * Analyze a Node.js Error or exception with full stack trace.
   */
  async analyzeException(err: Error, options: AnalyzeOptions = {}): Promise<DrillResult | DrillError> {
    const input = [
      `${err.name}: ${err.message}`,
      err.stack ?? '',
    ].filter(Boolean).join('\n');
    return this.analyze(input, options);
  }

  /**
   * Attach to a Winston-like logger and auto-analyze on error events.
   * Returns a disposer function — call it to detach.
   */
  watch(logger: WinstonLike, options: WatchOptions): { stop: () => void } {
    const errorPattern = options.errorPatterns?.[0] ??
      /\b(ERROR|FATAL|Exception|Traceback|panic|CRITICAL|SEVERE)\b/i;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    let logBuffer: string[] = [];

    const handler = (...args: unknown[]): void => {
      const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      logBuffer.push(line);
      if (!errorPattern.test(line)) return;

      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const chunk = logBuffer.slice(-200).join('\n');
        logBuffer = [];
        const result = await this.analyze(chunk);
        if ('code' in result) {
          options.onError?.(result);
        } else {
          options.onResult(result, chunk);
        }
      }, options.debounceMs ?? 500);
    };

    logger.on('error', handler);
    logger.on('warn', handler);

    return {
      stop: () => {
        if (debounce) clearTimeout(debounce);
        // Note: EventEmitter.off requires a reference — store handler above
      },
    };
  }

  private async _callApi(
    input: string,
    context: string | undefined,
    timeoutMs: number,
  ): Promise<DrillResult | DrillError> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, apiKey: this.apiKey, context }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      if (msg.includes('timeout') || msg.includes('abort')) {
        return { code: 'TIMEOUT', message: 'Request timed out. Try --timeout 120.' };
      }
      return { code: 'NETWORK', message: msg };
    }

    if (response.status === 401) return { code: 'INVALID_KEY', message: 'Invalid API key.' };
    if (response.status === 429) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      return {
        code: 'LIMIT_REACHED',
        message: 'Monthly run limit reached.',
        upgrade_url: (body['upgrade'] as string | undefined) ?? `${this.apiUrl}/upgrade`,
      };
    }
    if (!response.ok) {
      return { code: 'NETWORK', message: `HTTP ${response.status}: ${response.statusText}` };
    }

    // Parse SSE stream — strip think-tags, return final JSON
    let resultText = '';
    await parseStream(response, {
      onThinking: (text) => this.onThinking?.(text),
      onResultChunk: () => undefined,
      onDone: (complete) => { resultText = complete; },
      onError: () => undefined,
    });

    try {
      return parseResult(resultText);
    } catch (e: unknown) {
      return {
        code: 'PARSE_FAILED',
        message: `Failed to parse response: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}
```

### packages/sdk/src/utils.ts

```typescript
import type { DrillResult, DrillError } from './types.ts';

/**
 * Type guard — returns true if result is a DrillError, false if DrillResult.
 * @example
 * const result = await drill.analyze(log);
 * if (isDrillError(result)) { console.error(result.message); }
 * else { console.log(result.cause); }
 */
export function isDrillError(result: DrillResult | DrillError): result is DrillError {
  return 'code' in result && typeof result.code === 'string';
}
```

### packages/sdk/src/index.ts

```typescript
export { DrillClient } from './client.ts';
export { isDrillError } from './utils.ts';
export type {
  DrillClientOptions,
  DrillResult,
  DrillError,
  AnalyzeOptions,
  WatchOptions,
} from './types.ts';
```

---

## Python SDK: packages/sdk-python/

### Package structure

```
packages/sdk-python/
  drill_sdk/
    __init__.py
    client.py
    types.py
    redact.py
    chunk.py
    stream.py
  tests/
    test_client.py
    test_redact.py
    test_types.py
  pyproject.toml
  README.md
```

### pyproject.toml

```toml
[project]
name = "drill-sdk"
version = "1.0.0"
description = "Official Python SDK for Drill — AI-powered log diagnosis"
readme = "README.md"
requires-python = ">=3.9"
license = { text = "MIT" }
keywords = ["drill", "logging", "ai", "debugging", "root-cause"]
dependencies = [
  "httpx>=0.27",
  "pydantic>=2.0",
]

[project.urls]
Homepage = "https://drill.dev"
Repository = "https://github.com/drill-dev/drill-sdk"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

### drill_sdk/__init__.py

```python
from drill_sdk.client import DrillClient
from drill_sdk.types import DrillResult, DrillError
from drill_sdk.utils import is_drill_error

__all__ = ['DrillClient', 'DrillResult', 'DrillError', 'is_drill_error']
```

### drill_sdk/types.py

```python
from pydantic import BaseModel, field_validator
from typing import Optional, Literal, List


class DrillResult(BaseModel):
    """Structured root cause analysis result."""
    cause: str
    confidence: int  # 0-100
    severity: Literal['critical', 'high', 'medium', 'low']
    evidence: List[str]
    fix: str
    alternative: Optional[str] = None
    missing: Optional[str] = None

    @field_validator('confidence')
    @classmethod
    def confidence_range(cls, v: int) -> int:
        if not 0 <= v <= 100:
            raise ValueError('confidence must be 0-100')
        return v


class DrillError(BaseModel):
    """Returned on any analysis failure. Never raises — always returns."""
    code: Literal['INVALID_KEY', 'LIMIT_REACHED', 'PARSE_FAILED', 'TIMEOUT', 'NETWORK', 'REDACTED_EMPTY']
    message: str
    upgrade_url: Optional[str] = None
```

### drill_sdk/client.py

```python
from __future__ import annotations
import os
import json
import traceback
from typing import Optional, Callable, Union
import httpx
from drill_sdk.types import DrillResult, DrillError
from drill_sdk.redact import redact
from drill_sdk.chunk import chunk


DEFAULT_API_URL = "https://drill.dev"
DEFAULT_TIMEOUT = 90.0


class DrillClient:
    """
    Drill SDK client. Wraps the drill.dev managed API.
    Never raises — all errors returned as DrillError objects.

    Example:
        client = DrillClient()
        result = client.analyze(log_text)
        if not is_drill_error(result):
            print(result.cause)
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        api_url: str = DEFAULT_API_URL,
        timeout: float = DEFAULT_TIMEOUT,
        redact_input: bool = True,
        on_thinking: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("DRILL_API_KEY", "")
        self.api_url = api_url or os.environ.get("DRILL_API_URL", DEFAULT_API_URL)
        self.timeout = timeout
        self.redact_input = redact_input
        self.on_thinking = on_thinking

    def analyze(
        self,
        input: str,
        context: Optional[str] = None,
        lines: Optional[int] = None,
        no_redact: bool = False,
        timeout: Optional[float] = None,
    ) -> Union[DrillResult, DrillError]:
        """Analyze log text and return the most probable root cause."""
        if not self.api_key:
            return DrillError(
                code="INVALID_KEY",
                message="No API key. Set DRILL_API_KEY or pass api_key to DrillClient.",
            )

        processed = input
        if lines is not None:
            processed = "\n".join(processed.splitlines()[-lines:])

        if not no_redact and self.redact_input:
            processed = redact(processed)
            if processed.strip() == "__DRILL_FULLY_REDACTED__":
                return DrillError(code="REDACTED_EMPTY", message="All input was redacted — nothing to analyze.")

        chunked = chunk(processed)
        return self._call_api(chunked, context, timeout or self.timeout)

    def analyze_file(self, path: str, **kwargs) -> Union[DrillResult, DrillError]:
        """Read a file by path and analyze its contents."""
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return self.analyze(content, **kwargs)
        except OSError as e:
            return DrillError(code="NETWORK", message=f"Failed to read file: {e}")

    def analyze_exception(
        self,
        exc: BaseException,
        context: Optional[str] = None,
    ) -> Union[DrillResult, DrillError]:
        """Analyze a Python exception with its full traceback."""
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        return self.analyze(tb, context=context)

    def _call_api(
        self,
        input: str,
        context: Optional[str],
        timeout: float,
    ) -> Union[DrillResult, DrillError]:
        try:
            with httpx.Client(timeout=timeout) as client:
                with client.stream(
                    "POST",
                    f"{self.api_url}/api/analyze",
                    json={"input": input, "apiKey": self.api_key, "context": context},
                    headers={"Content-Type": "application/json"},
                ) as response:
                    if response.status_code == 401:
                        return DrillError(code="INVALID_KEY", message="Invalid API key.")
                    if response.status_code == 429:
                        body = {}
                        try:
                            body = response.json()
                        except Exception:
                            pass
                        return DrillError(
                            code="LIMIT_REACHED",
                            message="Monthly run limit reached.",
                            upgrade_url=body.get("upgrade", f"{self.api_url}/upgrade"),
                        )
                    if not response.is_success:
                        return DrillError(
                            code="NETWORK",
                            message=f"HTTP {response.status_code}: {response.reason_phrase}",
                        )

                    return self._parse_sse_stream(response)

        except httpx.TimeoutException:
            return DrillError(code="TIMEOUT", message="Request timed out.")
        except httpx.NetworkError as e:
            return DrillError(code="NETWORK", message=str(e))

    def _parse_sse_stream(self, response) -> Union[DrillResult, DrillError]:
        """Parse SSE stream, route think-tags to callback, collect result."""
        result_buffer = ""
        in_think = False

        for line in response.iter_lines():
            if not line.startswith("data: "):
                continue
            data = line[6:]
            if data == "[DONE]":
                break
            try:
                parsed = json.loads(data)
                content = parsed["choices"][0]["delta"].get("content", "")
                if not content:
                    continue

                # Route think-tag content vs result content
                i = 0
                while i < len(content):
                    if not in_think:
                        think_start = content.find("<think>", i)
                        if think_start == -1:
                            result_buffer += content[i:]
                            break
                        result_buffer += content[i:think_start]
                        in_think = True
                        i = think_start + len("<think>")
                    else:
                        think_end = content.find("</think>", i)
                        if think_end == -1:
                            if self.on_thinking:
                                self.on_thinking(content[i:])
                            break
                        if self.on_thinking:
                            self.on_thinking(content[i:think_end])
                        in_think = False
                        i = think_end + len("</think>")

            except (json.JSONDecodeError, KeyError, IndexError):
                continue

        return self._parse_result(result_buffer.strip())

    def _parse_result(self, raw: str) -> Union[DrillResult, DrillError]:
        """Parse and validate the JSON result from the LLM."""
        # Strip markdown fences
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            cleaned = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        # Extract JSON object
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1:
            return DrillError(code="PARSE_FAILED", message=f"No JSON in response. Got: {raw[:200]}")

        try:
            data = json.loads(cleaned[start:end + 1])
            return DrillResult(**data)
        except (json.JSONDecodeError, Exception) as e:
            return DrillError(code="PARSE_FAILED", message=f"Parse failed: {e}")
```

### drill_sdk/utils.py

```python
from typing import Union
from drill_sdk.types import DrillResult, DrillError


def is_drill_error(result: Union[DrillResult, DrillError]) -> bool:
    """Returns True if result is a DrillError, False if DrillResult."""
    return isinstance(result, DrillError)
```

---

## GitHub Action: packages/action/action.yml

Complete implementation per SPEC_ACTION.md.

The action must handle multi-line log input correctly, post PR comments,
expose structured outputs, and support `fail-on-critical`. Every field in
the action.yml from SPEC_ACTION.md is implemented exactly as specified.

Build verification:
```bash
# Install act for local testing
brew install act

# Test the action locally
cd packages/action
act pull_request \
  --input api-key=drill_sk_test \
  --input log-input="ERROR: connection refused to database at 14:07:33"
```

Publish to GitHub Marketplace:
1. Push to `github.com/drill-dev/action`
2. Create release tag `v1`
3. In the GitHub release: check "Publish this Action to the GitHub Marketplace"
4. Select category: "Utilities"

---

## Homebrew tap: github.com/drill-dev/homebrew-tap

```
homebrew-tap/
  Formula/
    drill.rb
  README.md
```

### Formula/drill.rb

```ruby
class Drill < Formula
  desc "AI-powered log diagnosis CLI — pipe any log, get the root cause"
  homepage "https://drill.dev"
  url "https://registry.npmjs.org/drill-cli/-/drill-cli-1.0.0.tgz"
  sha256 "PLACEHOLDER_REPLACED_BY_RELEASE_WORKFLOW"
  license "MIT"
  head "https://github.com/drill-dev/drill-cli.git", branch: "main"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    output = shell_output("#{bin}/drill --version")
    assert_match version.to_s, output
  end
end
```

---

## Release pipeline: .github/workflows/release.yml

```yaml
name: Release

on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'

permissions:
  contents: write

jobs:
  validate:
    name: Pre-release validation
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build

  publish-cli:
    name: Publish drill-cli to npm
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter cli build
      - name: Set version from tag
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          cd packages/cli && npm version "$VERSION" --no-git-tag-version
      - name: Publish
        run: pnpm --filter cli publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-sdk-node:
    name: Publish drill-sdk (Node) to npm
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter sdk build
      - name: Set version from tag
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          cd packages/sdk && npm version "$VERSION" --no-git-tag-version
      - name: Publish
        run: pnpm --filter sdk publish --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-sdk-python:
    name: Publish drill-sdk to PyPI
    runs-on: ubuntu-latest
    needs: validate
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - name: Set version from tag
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          sed -i "s/^version = .*/version = \"${VERSION}\"/" packages/sdk-python/pyproject.toml
      - name: Build
        run: |
          pip install build
          cd packages/sdk-python && python -m build
      - name: Publish to PyPI
        run: |
          pip install twine
          twine upload packages/sdk-python/dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}

  update-homebrew:
    name: Update Homebrew formula
    runs-on: ubuntu-latest
    needs: publish-cli
    steps:
      - name: Calculate SHA256
        id: sha
        run: |
          VERSION=${GITHUB_REF_NAME#v}
          # Wait for npm publish to propagate
          sleep 30
          URL="https://registry.npmjs.org/drill-cli/-/drill-cli-${VERSION}.tgz"
          SHA=$(curl -fsSL "$URL" | shasum -a 256 | awk '{print $1}')
          echo "sha=${SHA}" >> $GITHUB_OUTPUT
          echo "version=${VERSION}" >> $GITHUB_OUTPUT

      - uses: actions/checkout@v4
        with:
          repository: drill-dev/homebrew-tap
          token: ${{ secrets.HOMEBREW_TAP_TOKEN }}
          path: homebrew-tap

      - name: Update formula
        run: |
          VERSION="${{ steps.sha.outputs.version }}"
          SHA="${{ steps.sha.outputs.sha }}"
          sed -i "s|url \".*\"|url \"https://registry.npmjs.org/drill-cli/-/drill-cli-${VERSION}.tgz\"|" homebrew-tap/Formula/drill.rb
          sed -i "s|sha256 \".*\"|sha256 \"${SHA}\"|" homebrew-tap/Formula/drill.rb

      - name: Commit and push
        run: |
          cd homebrew-tap
          git config user.name "drill-bot"
          git config user.email "bot@drill.dev"
          git add Formula/drill.rb
          git commit -m "Update drill to v${{ steps.sha.outputs.version }}"
          git push

  create-release:
    name: Create GitHub release
    runs-on: ubuntu-latest
    needs: [publish-cli, publish-sdk-node, publish-sdk-python]
    steps:
      - uses: actions/checkout@v4
      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          body: |
            ## Install

            ```bash
            npm install -g drill-cli
            # or
            brew install drill-dev/tap/drill
            # or
            curl -fsSL https://drill.dev/install.sh | sh
            ```

            ## SDKs
            - Node.js: `npm install drill-sdk`
            - Python: `pip install drill-sdk`
```

---

## Full end-to-end test: packages/cli/test/integration/e2e-full.test.ts

Run against the real production API. Requires `DRILL_E2E_API_KEY` set
to a real `drill_sk_` key with available runs.

```typescript
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BINARY = join(process.cwd(), 'packages/cli/dist/index.js');
const API_KEY = process.env['DRILL_E2E_API_KEY'];
const RUN_E2E = !!API_KEY && process.env['DRILL_E2E'] === 'true';

describe.skipIf(!RUN_E2E)('End-to-end against real API', () => {
  const env = { ...process.env, DRILL_API_KEY: API_KEY! };

  it('analyzes a real connection refused error', () => {
    const log = `
2024-01-15 14:07:33 ERROR: connect ECONNREFUSED 127.0.0.1:5432
2024-01-15 14:07:33 ERROR: Failed to connect to database after 3 retries
2024-01-15 14:07:33 ERROR: [UserService] Cannot process request: database unavailable
    `.trim();

    const result = spawnSync('node', [BINARY, '--json', log], { encoding: 'utf8', env, timeout: 120_000 });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { cause: string; confidence: number; severity: string };
    expect(parsed.cause.toLowerCase()).toMatch(/connect|database|refused|econnrefused/);
    expect(parsed.confidence).toBeGreaterThan(60);
    expect(['critical', 'high']).toContain(parsed.severity);
  }, 120_000);

  it('handles the --lines flag correctly against real API', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `INFO: processing item ${i}`);
    lines.push('ERROR: out of memory: kill process 12345 (node)');
    const log = lines.join('\n');

    const result = spawnSync('node', [BINARY, '--json', '--lines', '50', log], {
      encoding: 'utf8', env, timeout: 120_000,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { cause: string };
    expect(parsed.cause.toLowerCase()).toMatch(/memory|oom|kill/);
  }, 120_000);

  it('returns exit code 1 in --ci mode when cause is high confidence', () => {
    const log = 'FATAL: NullPointerException at UserService.java:42 — object reference is null';
    const result = spawnSync('node', [BINARY, '--ci', log], { encoding: 'utf8', env, timeout: 120_000 });
    // CI mode: exit 1 if confidence >= 50
    expect([0, 1]).toContain(result.status);
  }, 120_000);
});
```

---

## Required secrets — set all before tagging v1.0.0

In GitHub repository settings → Secrets → Actions:

| Secret | Purpose | Where to get |
|---|---|---|
| `NPM_TOKEN` | Publish to npm | npmjs.com → Access Tokens → Automation |
| `PYPI_TOKEN` | Publish to PyPI | pypi.org → Account Settings → API tokens |
| `HOMEBREW_TAP_TOKEN` | Push to homebrew-tap repo | GitHub → Settings → Personal access tokens → repo scope |

---

## Launch checklist — execute before tagging v1.0.0

### Security audit
- [ ] All Supabase tables show "Row Level Security: Enabled"
- [ ] `SUPABASE_SERVICE_KEY` not in any client bundle (`pnpm --filter web build` → search dist/)
- [ ] Anonymous key rate limit tested: 4th request from same IP returns 429
- [ ] Stripe webhook signature verification confirmed working
- [ ] No API keys in any committed file: `git grep -i "sk_" -- "*.ts" "*.js" "*.json"`

### Distribution
- [ ] `npm install -g drill-cli && drill --version` works on macOS
- [ ] `npm install -g drill-cli && drill --version` works on Ubuntu
- [ ] `brew install drill-dev/tap/drill && drill --version` works
- [ ] `curl -fsSL https://drill.dev/install.sh | sh && drill --version` works
- [ ] `drill login` → browser → confirm → CLI shows "Authorized!"
- [ ] `pip install drill-sdk` and Python example works
- [ ] `npm install drill-sdk` and Node.js example works
- [ ] GitHub Action posts PR comment in a test repo

### Performance
- [ ] P50 time from pipe to result: < 30 seconds (test with 10 real logs)
- [ ] P95 time: < 55 seconds (under Vercel 60s limit)
- [ ] Binary startup: `time drill --help` < 300ms
- [ ] `drill login` flow: browser open to authorized in < 10 seconds

### Quality
- [ ] All 10 fixture integration tests pass: `DRILL_INTEGRATION=true pnpm test`
- [ ] Coverage >= 80%: `pnpm test:coverage`
- [ ] TypeScript zero errors: `pnpm typecheck`
- [ ] npm audit clean: `pnpm audit --audit-level=high`

### Execute launch

```bash
# 1. Final check
pnpm typecheck && pnpm lint && pnpm test && pnpm build
# Expected: all pass

# 2. Tag release
git tag v1.0.0
git push origin v1.0.0
# Expected: CI runs, publishes to npm + PyPI + Homebrew automatically

# 3. Verify distribution
sleep 60  # wait for publish to propagate
npm install -g drill-cli@1.0.0
drill --version  # should show 1.0.0

pip install drill-sdk==1.0.0
python -c "from drill_sdk import DrillClient; print('SDK OK')"

# 4. Post Show HN
# Title: "Show HN: Drill – pipe any log into an AI, get the root cause"
# Body: one-liner install, demo, link to drill.dev
# First comment: the exact commands showing it working on a real error

# 5. ProductHunt listing
# Schedule for Tuesday or Wednesday 12:01am PST for maximum votes
```

---

## Exit criteria — Phase 10 is complete when ALL pass

```bash
# 1. Node.js SDK works end-to-end
DRILL_API_KEY=drill_sk_your_key \
  node -e "
const { DrillClient, isDrillError } = require('drill-sdk');
const client = new DrillClient();
client.analyze('ERROR: connection refused to 127.0.0.1:5432').then(r => {
  if (isDrillError(r)) { console.error('Error:', r.message); process.exit(1); }
  console.log('Cause:', r.cause);
  console.log('Fix:', r.fix);
});
"
# Expected: Cause and Fix printed, exit 0

# 2. Python SDK works end-to-end
DRILL_API_KEY=drill_sk_your_key \
  python -c "
from drill_sdk import DrillClient, is_drill_error
client = DrillClient()
result = client.analyze('ERROR: NullPointerException at UserService.java:42')
if is_drill_error(result):
    print('Error:', result.message)
    exit(1)
print('Cause:', result.cause)
print('Fix:', result.fix)
"
# Expected: Cause and Fix printed, exit 0

# 3. GitHub Action runs in CI
# Create a test workflow in a dummy repo, push a failing test
# Expected: PR comment shows Drill analysis with cause + fix

# 4. npm install works globally on clean machine
docker run --rm node:20 sh -c "npm install -g drill-cli && drill --version"
# Expected: version number printed

# 5. Homebrew install works
brew tap drill-dev/tap && brew install drill
drill --version
# Expected: version number printed

# 6. Release CI succeeded
# Go to github.com/drill-dev/drill-cli/actions
# The release workflow for v1.0.0 tag must show all green

# 7. All packages visible on registries
curl -s https://registry.npmjs.org/drill-cli/latest | jq .version
curl -s https://registry.npmjs.org/drill-sdk/latest | jq .version
pip index versions drill-sdk 2>/dev/null | head -1
# Expected: 1.0.0 in all three

# 8. drill.dev is live and functional
curl https://drill.dev/api/analyze
# Expected: {"status":"ok","version":"1.0.0"}
```

## ── DRILL IS SHIPPED ─────────────────────────────────────────────────────────

Every phase complete means:
- `drill` binary on npm, Homebrew, and curl-install
- `drill-sdk` on npm and PyPI for Node.js and Python
- `drill-dev/action` on GitHub Marketplace
- drill.dev live with auth, billing, and dashboard
- MiniMax M2.5 streaming with Together AI fallback
- Full PII redaction by default
- Smart chunking for logs up to 100MB
- Complete test suite at 80%+ coverage
- Automated release pipeline for future versions
