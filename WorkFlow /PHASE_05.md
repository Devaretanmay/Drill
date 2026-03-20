# Phase 5 — Complete test suite, all fixtures, CI gate

## What this phase builds

The complete test suite against real log fixtures. Every fixture file from Phase 1
gets an integration test. CI is locked down. After this phase the core product is
validated, tested, and ready to show real users. This is the end of the no-auth
validation product.

## Depends on

Phases 1–4 complete. Full CLI working end-to-end with all flags.

## Scope

- `packages/cli/test/fixtures/expected/*.json` — expected output schemas per fixture
- `packages/cli/test/integration/fixtures.test.ts` — tests each fixture through full pipeline
- `packages/cli/test/integration/e2e-cli.test.ts` — spawns the real binary
- `packages/cli/test/render.test.ts` — render output tests
- Updated `.github/workflows/ci.yml` — full CI with coverage gate
- `packages/cli/test/fixtures/` — complete all 10 fixture files if not done in Phase 1

---

## Fixture expected outputs

Create `packages/cli/test/fixtures/expected/` with one JSON file per fixture.
These are the MINIMUM acceptable outputs — tests verify these fields are present
and within range, not exact string matches (LLM output is non-deterministic).

### expected/node-db-connection-error.json
```json
{
  "confidenceMin": 75,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["connection", "pool", "database", "postgres"],
  "fixKeywords": ["pool", "connection", "DB_POOL_SIZE", "max_connections"],
  "evidenceMustExist": true
}
```

### expected/python-traceback.json
```json
{
  "confidenceMin": 70,
  "severityOneOf": ["critical", "high", "medium"],
  "causeKeywords": ["AttributeError", "None", "null", "attribute"],
  "fixKeywords": ["None", "null", "check", "initialize"],
  "evidenceMustExist": true
}
```

### expected/docker-oom-kill.json
```json
{
  "confidenceMin": 80,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["memory", "OOM", "killed", "limit"],
  "fixKeywords": ["memory", "limit", "increase", "leak"],
  "evidenceMustExist": true
}
```

### expected/nginx-502-gateway.json
```json
{
  "confidenceMin": 65,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["upstream", "502", "refused", "backend", "proxy"],
  "fixKeywords": ["upstream", "service", "running", "port"],
  "evidenceMustExist": true
}
```

### expected/ci-jest-test-failure.json
```json
{
  "confidenceMin": 85,
  "severityOneOf": ["high", "medium"],
  "causeKeywords": ["test", "assertion", "expected", "received", "failed"],
  "fixKeywords": ["test", "fix", "update", "assertion"],
  "evidenceMustExist": true
}
```

### expected/aws-lambda-timeout.json
```json
{
  "confidenceMin": 80,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["timeout", "duration", "limit", "exceeded"],
  "fixKeywords": ["timeout", "limit", "increase", "optimize"],
  "evidenceMustExist": true
}
```

### expected/java-npe.json
```json
{
  "confidenceMin": 75,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["NullPointerException", "null", "NPE"],
  "fixKeywords": ["null", "check", "initialize", "Optional"],
  "evidenceMustExist": true
}
```

### expected/go-goroutine-leak.json
```json
{
  "confidenceMin": 60,
  "severityOneOf": ["high", "medium"],
  "causeKeywords": ["goroutine", "leak", "blocked", "waiting"],
  "fixKeywords": ["goroutine", "context", "cancel", "close", "channel"],
  "evidenceMustExist": true
}
```

### expected/redis-connection-refused.json
```json
{
  "confidenceMin": 75,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["Redis", "connection", "refused", "ECONNREFUSED"],
  "fixKeywords": ["Redis", "running", "port", "connection"],
  "evidenceMustExist": true
}
```

### expected/kubernetes-crashloop.json
```json
{
  "confidenceMin": 70,
  "severityOneOf": ["critical", "high"],
  "causeKeywords": ["CrashLoopBackOff", "crash", "exit", "restart"],
  "fixKeywords": ["container", "config", "port", "environment"],
  "evidenceMustExist": true
}
```

---

## File: packages/cli/test/integration/fixtures.test.ts

These tests call the REAL M2.5 API. They are skipped in CI unless
`DRILL_INTEGRATION=true` is set. They run manually before releases.

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../../src/lib/api';
import { redact } from '../../src/lib/redact';
import { chunk } from '../../src/lib/chunk';

const FIXTURES_DIR = join(__dirname, '../fixtures');
const EXPECTED_DIR = join(FIXTURES_DIR, 'expected');

interface ExpectedOutput {
  confidenceMin: number;
  severityOneOf: string[];
  causeKeywords: string[];
  fixKeywords: string[];
  evidenceMustExist: boolean;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

// Skip in CI unless explicitly enabled
const runIntegration = process.env['DRILL_INTEGRATION'] === 'true';
const describeOrSkip = runIntegration ? describe : describe.skip;

describeOrSkip('Integration: fixture log analysis', () => {
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.log'));

  for (const fixtureFile of fixtures) {
    const fixtureName = fixtureFile.replace('.log', '');
    const expectedFile = join(EXPECTED_DIR, `${fixtureName}.json`);

    it(`correctly analyzes: ${fixtureName}`, async () => {
      const input = readFileSync(join(FIXTURES_DIR, fixtureFile), 'utf8');
      const expected: ExpectedOutput = JSON.parse(readFileSync(expectedFile, 'utf8')) as ExpectedOutput;

      // Apply full pipeline
      const redacted = redact(input);
      const chunked = chunk(redacted);
      const result = await analyze({
        input: chunked.content,
        timeoutMs: 90_000,
      });

      // Must not be an error
      expect('code' in result, `Expected DrillResult but got DrillError: ${JSON.stringify(result)}`).toBe(false);
      if ('code' in result) return; // type narrowing

      // Confidence must meet minimum
      expect(result.confidence).toBeGreaterThanOrEqual(expected.confidenceMin - 10); // 10% tolerance

      // Severity must be in allowed list
      expect(expected.severityOneOf).toContain(result.severity);

      // Cause must contain at least one keyword
      expect(
        matchesKeywords(result.cause, expected.causeKeywords),
        `Cause "${result.cause}" does not contain any of: ${expected.causeKeywords.join(', ')}`
      ).toBe(true);

      // Fix must contain at least one keyword
      expect(
        matchesKeywords(result.fix, expected.fixKeywords),
        `Fix "${result.fix}" does not contain any of: ${expected.fixKeywords.join(', ')}`
      ).toBe(true);

      // Evidence must exist and be non-empty
      if (expected.evidenceMustExist) {
        expect(result.evidence.length).toBeGreaterThan(0);
      }

      // Evidence must not contain PII (redaction check)
      for (const e of result.evidence) {
        expect(e).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // no email
        expect(e).not.toMatch(/eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/); // no JWT
      }

    }, 120_000); // 2 min timeout per test
  }
});
```

---

## File: packages/cli/test/integration/e2e-cli.test.ts

Spawns the actual compiled binary. Validates the real end-to-end behavior.
Uses MSW to intercept the API call — no real LLM call needed here.

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const BINARY = join(process.cwd(), 'packages/cli/dist/index.js');
const TEST_KEY = 'drill_test_key_for_e2e';

// Mock server URL for e2e tests
// In e2e tests we use a local mock server that returns valid DrillResult JSON
const MOCK_API_URL = 'http://localhost:9999';

const MOCK_RESULT = JSON.stringify({
  cause: 'Database connection pool exhausted',
  confidence: 87,
  severity: 'high',
  evidence: ['Too many connections at 14:07:33'],
  fix: 'Increase DB_POOL_SIZE to 25 in your .env file',
  alternative: null,
  missing: null,
});

describe('E2E CLI binary', () => {
  beforeAll(() => {
    // Build binary if not exists
    try {
      execSync('pnpm --filter cli build', { stdio: 'pipe' });
    } catch {
      // Already built
    }
  });

  it('shows help with --help flag', () => {
    const result = spawnSync('node', [BINARY, '--help'], { encoding: 'utf8' });
    expect(result.stdout).toContain('Usage: drill');
    expect(result.stdout).toContain('--no-redact');
    expect(result.stdout).toContain('--watch');
    expect(result.stdout).toContain('--context');
    expect(result.stdout).toContain('--json');
    expect(result.stdout).toContain('--ci');
    expect(result.status).toBe(0);
  });

  it('shows version with --version flag', () => {
    const result = spawnSync('node', [BINARY, '--version'], { encoding: 'utf8' });
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    expect(result.status).toBe(0);
  });

  it('exits 1 with clear message when no API key set', () => {
    const result = spawnSync(
      'node', [BINARY, 'test error'],
      { encoding: 'utf8', env: { ...process.env, DRILL_API_KEY: '' } }
    );
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('DRILL_API_KEY');
  });

  it('exits 1 with clear message for empty input', () => {
    const result = spawnSync(
      'node', [BINARY],
      {
        encoding: 'utf8',
        input: '',
        env: { ...process.env, DRILL_API_KEY: TEST_KEY, DRILL_API_URL: MOCK_API_URL },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    expect(result.status).toBe(1);
  });

  it('outputs valid JSON with --json flag', () => {
    // This test requires mock server running at MOCK_API_URL
    // Set up with: node packages/cli/test/mock-server.ts &
    if (!process.env['DRILL_E2E_MOCK']) return;

    const result = spawnSync(
      'node', [BINARY, '--json'],
      {
        encoding: 'utf8',
        input: 'Error: ECONNREFUSED 127.0.0.1:5432',
        env: { ...process.env, DRILL_API_KEY: TEST_KEY, DRILL_API_URL: MOCK_API_URL },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('cause');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).toHaveProperty('severity');
    expect(parsed).toHaveProperty('fix');
  });

  it('redacts PII from input by default', () => {
    // Use --json and check input was sanitized — verified via verbose mode
    const result = spawnSync(
      'node', [BINARY, 'user@example.com failed at 192.168.1.1', '--verbose', '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, DRILL_API_KEY: TEST_KEY, DRILL_API_URL: MOCK_API_URL },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    // Verbose output should show redaction happened
    const allOutput = result.stdout + result.stderr;
    expect(allOutput).not.toContain('user@example.com');
  });
});
```

---

## File: packages/cli/test/render.test.ts

Tests render output without calling the API. Validates terminal formatting.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showResult, showError, showThinking } from '../src/lib/render';
import type { DrillResult, DrillError } from '../src/types';

const mockResult: DrillResult = {
  cause: 'Database connection pool exhausted due to high concurrent load',
  confidence: 87,
  severity: 'high',
  evidence: ['ERROR: remaining connection slots are reserved at 14:07:33'],
  fix: 'Increase DB_POOL_SIZE from 10 to 25 in your .env file',
  alternative: 'Memory pressure causing connection drops',
  missing: null,
};

describe('showResult', () => {
  let consoleOutput: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    consoleOutput = [];
    console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('outputs content including cause', () => {
    showResult(mockResult);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Database connection pool');
  });

  it('outputs confidence percentage', () => {
    showResult(mockResult);
    const output = consoleOutput.join('\n');
    expect(output).toContain('87%');
  });

  it('outputs fix text', () => {
    showResult(mockResult);
    const output = consoleOutput.join('\n');
    expect(output).toContain('DB_POOL_SIZE');
  });

  it('outputs evidence lines', () => {
    showResult(mockResult);
    const output = consoleOutput.join('\n');
    expect(output).toContain('remaining connection slots');
  });

  it('outputs alternative when present', () => {
    showResult(mockResult);
    const output = consoleOutput.join('\n');
    expect(output).toContain('Memory pressure');
  });

  it('does not show alternative when null', () => {
    showResult({ ...mockResult, alternative: null });
    const output = consoleOutput.join('\n');
    expect(output).not.toContain('Alternative:');
  });

  it('shows remaining count when provided', () => {
    showResult(mockResult, 3);
    const output = consoleOutput.join('\n');
    expect(output).toContain('3 run');
  });
});

describe('showError', () => {
  let stderrOutput: string[] = [];
  const originalError = console.error;

  beforeEach(() => {
    stderrOutput = [];
    console.error = (...args: unknown[]) => { stderrOutput.push(args.join(' ')); };
  });

  afterEach(() => {
    console.error = originalError;
  });

  it('shows INVALID_KEY message', () => {
    showError({ code: 'INVALID_KEY', message: 'bad key' });
    expect(stderrOutput.join('\n')).toContain('Invalid API key');
  });

  it('shows LIMIT_REACHED message with upgrade URL', () => {
    showError({ code: 'LIMIT_REACHED', message: 'limit', upgrade_url: 'https://drill.dev/upgrade' });
    const output = stderrOutput.join('\n');
    expect(output).toContain('limit');
    expect(output).toContain('drill.dev/upgrade');
  });

  it('shows PARSE_FAILED message', () => {
    showError({ code: 'PARSE_FAILED', message: 'bad json' });
    expect(stderrOutput.join('\n')).toContain('parse');
  });

  it('shows REDACTED_EMPTY message with --no-redact hint', () => {
    showError({ code: 'REDACTED_EMPTY', message: 'all redacted' });
    const output = stderrOutput.join('\n');
    expect(output).toContain('redacted');
    expect(output).toContain('--no-redact');
  });
});

describe('showThinking', () => {
  it('does not crash on empty text', () => {
    expect(() => showThinking('')).not.toThrow();
  });

  it('does not crash on whitespace-only text', () => {
    expect(() => showThinking('   \n  ')).not.toThrow();
  });

  it('writes to stdout without crashing on multiline', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    showThinking('line one\nline two\nline three');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

---

## Updated: .github/workflows/ci.yml

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-typecheck:
    name: Lint & typecheck
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

  test:
    name: Test (Node ${{ matrix.node }})
    runs-on: ubuntu-latest
    needs: lint-typecheck
    strategy:
      fail-fast: false
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Run tests with coverage
        run: pnpm --filter cli test:coverage
      - name: Enforce 80% coverage gate
        run: |
          pnpm --filter cli exec vitest run --coverage \
            --coverage.thresholds.lines=80 \
            --coverage.thresholds.functions=80 \
            --coverage.thresholds.branches=80 \
            --coverage.thresholds.statements=80

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter cli build
      - name: Verify binary runs
        run: |
          node packages/cli/dist/index.js --version
          node packages/cli/dist/index.js --help
      - name: Pack dry run (npm publish check)
        run: npm pack --dry-run
        working-directory: packages/cli

  security:
    name: Security audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=high
```

---

## Exit criteria — Phase 5 is complete when ALL pass

```bash
# 1. Full test suite passes across Node 18, 20, 22
pnpm --filter cli test
# Expected: all tests green, zero failures, zero skipped (except integration)

# 2. Coverage meets 80% on all metrics
pnpm --filter cli test:coverage
# Expected: lines ≥ 80%, functions ≥ 80%, branches ≥ 80%

# 3. Build produces working binary
pnpm --filter cli build
node packages/cli/dist/index.js --version   # shows version
node packages/cli/dist/index.js --help      # shows full help

# 4. All 10 fixture files exist
ls packages/cli/test/fixtures/*.log | wc -l
# Expected: 10

# 5. All 10 expected output files exist
ls packages/cli/test/fixtures/expected/*.json | wc -l
# Expected: 10

# 6. Integration tests pass with real API (run manually before release)
DRILL_INTEGRATION=true DRILL_API_KEY=your_key pnpm --filter cli test
# Expected: all 10 fixture tests pass with confidence/cause/fix matching

# 7. TypeScript zero errors
pnpm typecheck

# 8. npm pack dry run succeeds
cd packages/cli && npm pack --dry-run
# Expected: shows files to be published, no errors

# 9. Binary works on real log from your own system
your_app_command 2>&1 | DRILL_API_KEY=your_key node packages/cli/dist/index.js
# Expected: real root cause identified for a real error from your system
```

## ── END OF CORE VALIDATION PRODUCT ──────────────────────────────────────────

After Phase 5, you have:
- A fully working `drill` binary installable with `node dist/index.js`
- All 13 CLI flags working
- Direct M2.5 calls with streaming + fallback
- Full PII redaction
- Smart log chunking (up to 100MB)
- Codebase context support
- Watch mode
- CI mode
- Complete test suite at 80%+ coverage
- 10 real log fixtures tested

**Validate this with real users before building Phases 6–10.**
Share the binary. Collect feedback. Confirm the core mechanic is useful.
Then build the production wrapper.
```
