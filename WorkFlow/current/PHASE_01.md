# Phase 1 — Monorepo scaffold, types, redact, chunk

## What this phase builds

The pure logic foundation. No LLM calls. No CLI. No network.
Just the data types every other file depends on, plus the two most critical
utility functions: PII redaction and log chunking. Both are fully tested before
Phase 2 touches them.

## Scope: what is built in this phase only

- pnpm monorepo workspace scaffold
- `packages/cli` package scaffold with TypeScript strict config
- `packages/cli/src/types.ts` — all shared types
- `packages/cli/src/lib/redact.ts` — PII redaction, all 13 patterns
- `packages/cli/src/lib/chunk.ts` — smart log chunking up to 100MB
- `packages/cli/test/redact.test.ts` — complete unit tests
- `packages/cli/test/chunk.test.ts` — complete unit tests
- `packages/cli/test/fixtures/` — 10 real log fixture files
- Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- CI config: `.github/workflows/ci.yml`

## What is NOT built in this phase

Auth, API calls, CLI entry point, rendering, streaming — none of that.
This phase is deliberately narrow. Only pure functions with zero dependencies
on network or runtime state.

---

## File: pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

---

## File: tsconfig.base.json (root)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

---

## File: packages/cli/package.json

```json
{
  "name": "drill-cli",
  "version": "1.0.0",
  "description": "AI-powered log diagnosis CLI",
  "bin": { "drill": "./dist/index.js" },
  "main": "./dist/index.js",
  "types": "./dist/types.d.ts",
  "engines": { "node": ">=18.0.0" },
  "scripts": {
    "build": "tsx build.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test --ext .ts",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "boxen": "^8.0.1",
    "commander": "^12.1.0",
    "conf": "^13.0.0",
    "ora": "^8.0.1",
    "chokidar": "^4.0.0",
    "eventsource-parser": "^3.0.0",
    "zod": "^3.23.0",
    "open": "^10.1.0",
    "glob": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "esbuild": "^0.24.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "msw": "^2.7.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

---

## File: packages/cli/tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

---

## File: packages/cli/vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
```

---

## File: packages/cli/src/types.ts

Build the complete type definitions exactly as specified in SPEC_CLI.md section
"types.ts — complete type definitions". Every interface, every union type, every
field. No partial implementations.

Additional types needed in Phase 1:

```typescript
// Chunk result metadata
export interface ChunkResult {
  content: string;
  wasChunked: boolean;
  originalLines: number;
  resultLines: number;
  strategy: 'passthrough' | 'tail' | 'error-context' | 'mixed';
}

// Redaction stats
export interface RedactStats {
  patternsMatched: Record<string, number>;
  totalReplacements: number;
  charsRemoved: number;
}

// Log fixture for testing
export interface LogFixture {
  name: string;
  input: string;
  expectedPatterns: string[];   // strings that should appear in result
  shouldNotContain: string[];   // PII strings that must NOT appear after redact
}
```

---

## File: packages/cli/src/lib/redact.ts

Implement exactly as specified in SPEC_CLI.md section "redact.ts".

All 13 patterns implemented. `redact()` is a pure function — same input always
same output. Export both `redact()` and `redactWithStats()`.

```typescript
/**
 * Redacts all PII and secrets from log input before sending to LLM.
 * Applied by default on all input. Can be disabled with --no-redact flag.
 * @param input Raw log string
 * @returns Redacted log string with all PII replaced by placeholder tokens
 */
export function redact(input: string): string { ... }

/**
 * Same as redact() but also returns statistics about what was redacted.
 * Used by --verbose flag to show redaction summary.
 * @param input Raw log string
 * @returns Object with redacted string and stats about replacements made
 */
export function redactWithStats(input: string): { redacted: string; stats: RedactStats } { ... }
```

Additional requirement: handle the case where redaction removes ALL content.
If `redacted.trim().length === 0` and `input.trim().length > 0`, return
the special sentinel `'__DRILL_FULLY_REDACTED__'` so the calling code can
throw `DrillError { code: 'REDACTED_EMPTY' }`.

---

## File: packages/cli/src/lib/chunk.ts

Implement exactly as specified in SPEC_CLI.md section "chunk.ts".

```typescript
/**
 * Intelligently chunks large log input to fit within LLM context window.
 * Preserves the most diagnostically relevant content: error lines with
 * surrounding context, recent tail, and startup head lines.
 * @param input Full log string, any size
 * @param options Chunking configuration
 * @returns ChunkResult with processed content and metadata
 */
export function chunk(input: string, options?: Partial<ChunkOptions>): ChunkResult { ... }

/**
 * Estimates token count for a string (rough: chars / 4).
 * Used to decide whether chunking is needed.
 */
export function estimateTokens(input: string): number { ... }

/**
 * Finds line indices containing error keywords.
 * Used by chunk() to extract error context windows.
 */
export function findErrorLines(lines: string[]): number[] { ... }
```

Default ChunkOptions values:
- `maxChars`: 320000 (approx 80k tokens)
- `lastNLines`: 200
- `headLines`: 20
- `contextRadius`: 50

The `findErrorLines` function matches against:
`/\b(ERROR|FATAL|Exception|Traceback|panic:|CRITICAL|SEVERE|stderr:|Killed|OOM|segfault|core dumped|assertion failed)\b/i`

---

## Test fixtures: packages/cli/test/fixtures/

Create these 10 real log files. Each must be realistic enough to be
diagnostically meaningful — not toy examples:

### node-db-connection-error.log
A Node.js Express app log showing PostgreSQL connection pool exhausted.
Include: timestamp, process info, actual pg error message "remaining connection
slots are reserved", stack trace to actual file:line references, multiple
repeated errors showing the problem compounding.

### python-traceback.log
Python Flask app crash. AttributeError on a None object, full traceback
through Flask internals to user code, the actual line that failed visible.

### docker-oom-kill.log
Docker daemon + kernel logs showing OOM killer activated, container name,
memory limit, which process was killed, cgroup memory stats.

### nginx-502-gateway.log
Nginx access + error log mixed. Multiple 502 errors, upstream connection
refused messages, upstream host:port visible (as [IP] since it gets redacted),
timestamps showing the outage window.

### ci-jest-test-failure.log
GitHub Actions Jest output. One test suite failing, the specific assertion
that failed with expected vs received values, test file name and line number,
full Jest summary at bottom.

### aws-lambda-timeout.log
AWS Lambda structured JSON logs. Function timeout, duration vs limit,
memory usage, request ID (which will be redacted as UUID), cold start
indicator, the actual function name and handler.

### java-npe.log
Java Spring Boot log. NullPointerException with full stack trace, Spring
context loading info before it, actual class names and line numbers, the
bean that failed to initialize.

### go-goroutine-leak.log
Go runtime goroutine dump showing leaked goroutines. Multiple goroutine
stacks, the blocking call visible, runtime/proc.go references, actual
user code frames mixed in.

### redis-connection-refused.log
Application log showing Redis connection failures. Multiple retry attempts,
exponential backoff visible in timestamps, eventual circuit breaker open,
the downstream effects (cache miss, DB fallback) cascading.

### kubernetes-crashloop.log
kubectl logs output showing CrashLoopBackOff. Container exit codes,
restart count, the actual application error that caused the crash
(config missing, port already in use), pod and namespace names.

---

## Test file: packages/cli/test/redact.test.ts

Complete test suite for `redact.ts`. Must cover every pattern.

```typescript
import { describe, it, expect } from 'vitest';
import { redact, redactWithStats } from '../src/lib/redact';

describe('redact', () => {
  // Email
  it('redacts standard email addresses', () => {
    expect(redact('Failed to email john.doe@example.com')).toBe('Failed to email [EMAIL]');
  });
  it('redacts emails with plus addressing', () => {
    expect(redact('user+tag@subdomain.company.co.uk')).toContain('[EMAIL]');
  });

  // IPv4
  it('redacts IPv4 addresses', () => {
    expect(redact('connecting to 192.168.1.100:5432')).toBe('connecting to [IP]:5432');
  });
  it('redacts IPv4 in URL context', () => {
    expect(redact('http://10.0.0.1/api')).not.toContain('10.0.0.1');
  });

  // JWT
  it('redacts full JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redact(`Authorization: Bearer ${jwt}`)).toBe('Authorization: Bearer [TOKEN]');
  });

  // AWS keys
  it('redacts AWS access key IDs', () => {
    expect(redact('aws_access_key_id = AKIAIOSFODNN7EXAMPLE')).toContain('[AWS_KEY]');
  });

  // Key=value secrets
  it('redacts password= patterns', () => {
    expect(redact('DB_PASSWORD=mysecretpassword123')).toContain('[REDACTED]');
  });
  it('redacts token= patterns case insensitively', () => {
    expect(redact('API_TOKEN=abc123def456')).toContain('[REDACTED]');
  });

  // DSN / connection strings
  it('redacts database connection strings', () => {
    expect(redact('postgres://user:pass@db.host.com:5432/mydb')).toBe('[DSN]');
  });
  it('redacts Redis connection strings', () => {
    expect(redact('redis://:password@127.0.0.1:6379')).toContain('[DSN]');
  });

  // UUID
  it('redacts UUIDs', () => {
    expect(redact('request_id: 550e8400-e29b-41d4-a716-446655440000')).toContain('[UUID]');
  });

  // SSH keys
  it('redacts SSH private keys', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----';
    expect(redact(key)).toContain('[SSH_KEY]');
  });

  // Preservation of non-PII content
  it('preserves error messages that contain no PII', () => {
    const log = 'ERROR: connection refused at UserService.java:42';
    expect(redact(log)).toBe(log);
  });
  it('preserves stack trace structure', () => {
    const trace = 'at Object.connect (node_modules/pg/lib/client.js:54:17)';
    expect(redact(trace)).toBe(trace);
  });

  // Edge cases
  it('handles empty string', () => { expect(redact('')).toBe(''); });
  it('handles string with only whitespace', () => { expect(redact('   \n  ')).toBe('   \n  '); });
  it('handles string with only PII', () => {
    const result = redact('john@example.com');
    expect(result).toBe('[EMAIL]');
  });
  it('returns sentinel when all content is redacted', () => {
    // Input that becomes empty after redaction
    const allPii = 'john@example.com 192.168.1.1';
    const result = redact(allPii);
    expect(result).not.toBe('');  // should be replacement tokens, not empty
  });

  // redactWithStats
  it('returns correct replacement count in stats', () => {
    const { stats } = redactWithStats('user@test.com logged in from 10.0.0.1');
    expect(stats.totalReplacements).toBe(2);
  });
});
```

---

## Test file: packages/cli/test/chunk.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { chunk, estimateTokens, findErrorLines } from '../src/lib/chunk';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => { expect(estimateTokens('')).toBe(0); });
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBeCloseTo(100, 0);
  });
});

describe('findErrorLines', () => {
  it('finds ERROR keyword lines', () => {
    const lines = ['info: started', 'ERROR: connection refused', 'info: retrying'];
    expect(findErrorLines(lines)).toEqual([1]);
  });
  it('finds Exception keyword lines', () => {
    const lines = ['at', 'NullPointerException: null', 'at UserService'];
    expect(findErrorLines(lines)).toEqual([1]);
  });
  it('finds multiple error lines', () => {
    const lines = ['ERROR: first', 'ok', 'FATAL: second', 'ok'];
    expect(findErrorLines(lines)).toEqual([0, 2]);
  });
  it('returns empty array for clean logs', () => {
    expect(findErrorLines(['info: all good', 'debug: processing'])).toEqual([]);
  });
});

describe('chunk', () => {
  it('returns input unchanged if under maxChars', () => {
    const input = 'short log\nno issues';
    const result = chunk(input);
    expect(result.content).toBe(input);
    expect(result.wasChunked).toBe(false);
    expect(result.strategy).toBe('passthrough');
  });

  it('applies chunking when over maxChars limit', () => {
    const bigLog = Array.from({ length: 10000 }, (_, i) => `line ${i}: some log content here`).join('\n');
    const result = chunk(bigLog, { maxChars: 1000 });
    expect(result.wasChunked).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(1000 + 100); // small buffer
  });

  it('always keeps last N lines', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = chunk(input, { maxChars: 100, lastNLines: 10 });
    expect(result.content).toContain('line 499');
    expect(result.content).toContain('line 490');
  });

  it('always keeps head lines', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const input = lines.join('\n');
    const result = chunk(input, { maxChars: 100, headLines: 5, lastNLines: 5 });
    expect(result.content).toContain('line 0');
    expect(result.content).toContain('line 4');
  });

  it('extracts context around ERROR lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    lines[100] = 'ERROR: something broke at line 100';
    const input = lines.join('\n');
    const result = chunk(input, { maxChars: 500, contextRadius: 3 });
    expect(result.content).toContain('ERROR: something broke');
    expect(result.content).toContain('line 97');   // contextRadius before
    expect(result.content).toContain('line 103');  // contextRadius after
  });

  it('never splits a line mid-way', () => {
    const input = Array.from({ length: 1000 }, (_, i) => `complete line ${i} with content`).join('\n');
    const result = chunk(input, { maxChars: 500 });
    const resultLines = result.content.split('\n');
    for (const line of resultLines) {
      if (line === '... [truncated] ...') continue;
      // Every line should match a complete original line
      expect(lines => lines.some((l: string) => l === line) || line === '').toBeTruthy();
    }
  });

  it('handles empty input', () => {
    const result = chunk('');
    expect(result.content).toBe('');
    expect(result.wasChunked).toBe(false);
  });

  it('handles single line input', () => {
    const result = chunk('just one line');
    expect(result.content).toBe('just one line');
  });

  it('handles 100MB input within 500ms', () => {
    const bigInput = 'a'.repeat(100 * 1024 * 1024);
    const start = Date.now();
    const result = chunk(bigInput);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(result.wasChunked).toBe(true);
  });

  it('includes truncation marker when chunking', () => {
    const bigLog = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n');
    const result = chunk(bigLog, { maxChars: 1000 });
    expect(result.content).toContain('[truncated]');
  });

  it('reports correct originalLines count', () => {
    const input = 'a\nb\nc\nd\ne';
    const result = chunk(input);
    expect(result.originalLines).toBe(5);
  });
});
```

---

## File: .github/workflows/ci.yml

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test with coverage
        run: pnpm test:coverage

      - name: Build
        run: pnpm build

      - name: Coverage gate (80% minimum)
        run: |
          pnpm --filter cli vitest run --coverage \
            --coverage.thresholds.lines=80 \
            --coverage.thresholds.functions=80 \
            --coverage.thresholds.branches=80

  publish-check:
    name: Publish dry run
    runs-on: ubuntu-latest
    needs: test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npm pack --dry-run
        working-directory: packages/cli
```

---

## Exit criteria — Phase 1 is complete when ALL of these pass

Run each command and confirm zero errors:

```bash
# 1. TypeScript compiles with zero errors
pnpm typecheck
# Expected: no output (clean)

# 2. All tests pass
pnpm --filter cli test
# Expected: "✓ redact.test.ts (18 tests)" and "✓ chunk.test.ts (15 tests)"

# 3. Coverage meets threshold
pnpm --filter cli test:coverage
# Expected: lines, functions, branches all >= 80%

# 4. Both utility functions work correctly via quick smoke test
node -e "
const { redact } = require('./packages/cli/src/lib/redact.ts');
" 2>&1 || tsx -e "
import { redact } from './packages/cli/src/lib/redact.ts';
import { chunk } from './packages/cli/src/lib/chunk.ts';
const r = redact('user@test.com failed at 192.168.1.1');
console.assert(r.includes('[EMAIL]'), 'email not redacted');
console.assert(r.includes('[IP]'), 'IP not redacted');
const c = chunk('line1\nline2\nline3');
console.assert(c.wasChunked === false, 'should not chunk small input');
console.log('PASS: redact and chunk work correctly');
"

# 5. Fixture files exist
ls packages/cli/test/fixtures/*.log | wc -l
# Expected: 10
```

**Do not start Phase 2 until all 5 checks pass cleanly.**
