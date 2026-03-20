# SPEC_TESTING — Test strategy and requirements

## Philosophy

Every feature ships with tests. No exceptions. The test suite is the contract — if a test passes, the feature works. Tests are written to test behavior, not implementation.

---

## Test stack

- **Unit tests**: Vitest (all packages)
- **Integration tests**: Vitest + MSW (mock service worker for API mocking)
- **E2E tests**: Playwright (web only)
- **Coverage enforcement**: 80% minimum — CI fails below this
- **Test data**: Real log samples in `packages/cli/test/fixtures/`

---

## CLI test fixtures (packages/cli/test/fixtures/)

These are real log files used in unit tests. Each has a corresponding expected DrillResult in `fixtures/expected/`:

```
fixtures/
  node-db-connection-error.log      # PostgreSQL connection pool exhausted
  python-traceback.log               # Python AttributeError with traceback
  docker-oom-kill.log                # Container OOM killed
  nginx-502-gateway.log             # Upstream connection refused
  k8s-crashloop.log                  # CrashLoopBackOff
  ci-jest-test-failure.log          # Jest test failure output
  rust-panic.log                     # Rust thread panic
  java-npe.log                       # Java NullPointerException
  go-goroutine-leak.log             # Go goroutine stack dump
  aws-lambda-timeout.log            # Lambda function timeout
  expected/
    node-db-connection-error.json   # { cause: "...", confidence: 87, ... }
    python-traceback.json
    ... (one per fixture)
```

---

## redact.ts tests — must all pass

```typescript
// test/redact.test.ts
describe('redact', () => {
  it('redacts email addresses', () => {
    expect(redact('user john.doe@company.com failed')).toBe('user [EMAIL] failed');
  });
  it('redacts IPv4 addresses', () => {
    expect(redact('connecting to 192.168.1.100:5432')).toBe('connecting to [IP]:5432');
  });
  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.hash';
    expect(redact(`Bearer ${jwt}`)).toBe('Bearer [TOKEN]');
  });
  it('redacts AWS keys', () => {
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('[AWS_KEY]');
  });
  it('redacts key=value secrets', () => {
    expect(redact('DB_PASSWORD=supersecret123')).toContain('[REDACTED]');
  });
  it('redacts DSNs', () => {
    expect(redact('postgres://user:pass@host:5432/db')).toBe('[DSN]');
  });
  it('preserves non-sensitive content', () => {
    const log = 'ERROR: connection refused at UserService.java:42';
    expect(redact(log)).toBe(log);  // nothing redacted
  });
  it('handles empty input', () => {
    expect(redact('')).toBe('');
  });
  it('handles input with only redactable content', () => {
    const result = redact('john@doe.com 192.168.1.1');
    expect(result.trim()).toBe('[EMAIL] [IP]');
  });
});
```

---

## chunk.ts tests

```typescript
describe('smartChunk', () => {
  it('returns input unchanged if under maxChars', () => { ... });
  it('keeps last 200 lines when over limit', () => { ... });
  it('keeps head 20 lines when over limit', () => { ... });
  it('extracts context around ERROR lines', () => { ... });
  it('deduplicates lines', () => { ... });
  it('never splits mid-line', () => { ... });
  it('handles input with no newlines', () => { ... });
  it('handles 100MB input without hanging', () => { ... }); // must complete in < 500ms
});
```

---

## stream.ts tests

```typescript
describe('parseStream', () => {
  it('separates <think> content from result content', () => { ... });
  it('handles think tags split across multiple chunks', () => { ... });
  it('calls onThinking with think content', () => { ... });
  it('calls onDone with complete JSON when stream ends', () => { ... });
  it('handles [DONE] sentinel correctly', () => { ... });
  it('handles malformed SSE chunks gracefully', () => { ... });
  it('handles empty stream', () => { ... });
});
```

---

## api.ts tests (using MSW)

```typescript
describe('api.analyze', () => {
  it('sends correct request body', () => { ... });
  it('handles 401 as DrillError INVALID_KEY', () => { ... });
  it('handles 429 as DrillError LIMIT_REACHED with upgrade URL', () => { ... });
  it('retries on network error', () => { ... });
  it('falls back to Together AI on primary 5xx', () => { ... });
  it('does not retry on 401', () => { ... });
  it('does not retry on 429', () => { ... });
  it('respects timeout option', () => { ... });
});
```

---

## run.ts command tests

```typescript
describe('run command', () => {
  it('reads from stdin when no inline arg', () => { ... });
  it('reads inline arg when provided', () => { ... });
  it('applies redaction by default', () => { ... });
  it('skips redaction with --no-redact flag', () => { ... });
  it('limits lines with --lines flag', () => { ... });
  it('outputs JSON with --json flag', () => { ... });
  it('exits with code 1 on high-confidence result with --ci flag', () => { ... });
  it('exits with code 0 on low-confidence result with --ci flag', () => { ... });
  it('shows upgrade prompt when LIMIT_REACHED', () => { ... });
  it('handles empty input gracefully', () => { ... });
  it('handles REDACTED_EMPTY error gracefully', () => { ... });
});
```

---

## Integration tests — real fixture logs

```typescript
// test/integration/fixtures.test.ts
// These tests use MSW to mock the API response with pre-computed expected outputs
// They verify: correct input sent, correct output rendered, correct exit code

describe.each(FIXTURE_CASES)('fixture: %s', ({ inputFile, expectedOutput }) => {
  it('produces expected structured output', async () => {
    const input = fs.readFileSync(`fixtures/${inputFile}`, 'utf8');
    const result = await analyzeInput(input);
    expect(result.cause).toBeTruthy();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.severity).toMatch(/critical|high|medium|low/);
    expect(result.fix).toBeTruthy();
  });
});
```

---

## API route tests (packages/web)

```typescript
// Test: POST /api/analyze
describe('POST /api/analyze', () => {
  it('returns 400 if input missing', () => { ... });
  it('returns 401 if apiKey invalid', () => { ... });
  it('returns 429 if run_count >= run_limit', () => { ... });
  it('increments run_count on success', () => { ... });
  it('streams SSE response', () => { ... });
  it('includes X-Drill-Remaining header', () => { ... });
  it('uses fallback provider on primary failure', () => { ... });
});
```

---

## E2E tests (Playwright)

```typescript
// test/e2e/auth.spec.ts
test('user can sign up and see dashboard', async ({ page }) => { ... });
test('user can copy API key', async ({ page }) => { ... });

// test/e2e/cli-auth.spec.ts
test('CLI login flow completes in browser', async ({ page }) => { ... });

// test/e2e/upgrade.spec.ts
test('upgrade CTA opens Stripe checkout', async ({ page }) => { ... });
```

---

## CI configuration (packages/.github/workflows/ci.yml)

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'pnpm' }
      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test --coverage
      - run: pnpm build
      - name: Coverage gate
        run: pnpm vitest run --coverage --coverage.thresholds.lines=80
```
