# Phase 3 — CLI binary: entry point, run command, render layer

## What this phase builds

The actual `drill` command. After this phase you can run:
```
echo "Error: connection refused" | drill
cat any-log-file.log | drill
drill "NullPointerException at UserService.java:42"
```
and get a formatted result in your terminal. This is the core product validation moment.
No auth, no rate limits — just direct M2.5 calls using DRILL_API_KEY from environment.

## Depends on

Phase 1 (types, redact, chunk) and Phase 2 (stream, api, prompts) complete and tested.

## Scope: what is built in this phase only

- `packages/cli/src/index.ts` — entry point with shebang, commander setup
- `packages/cli/src/commands/run.ts` — the core `drill [input]` command
- `packages/cli/src/lib/render.ts` — complete terminal rendering layer
- `packages/cli/src/lib/env.ts` — runtime environment validation
- `packages/cli/build.ts` — esbuild compilation to standalone binary
- `packages/cli/test/commands/run.test.ts` — command tests
- `packages/cli/test/render.test.ts` — render output tests

## What is NOT built in this phase

`drill login`, `drill status`, `drill config`, `--watch`, `--context` flags — Phase 4.
Tests for fixtures running end-to-end — Phase 5.

---

## File: packages/cli/src/lib/env.ts

Validates all required environment variables at startup.
In Phase 3 (no-auth mode), only `DRILL_API_KEY` is required.

```typescript
import { z } from 'zod';

// Phase 3: minimal env — direct API access, no auth required
const Phase3EnvSchema = z.object({
  DRILL_API_KEY: z.string().min(1, 'DRILL_API_KEY is required. Set it in your environment.'),
  DRILL_API_URL: z.string().url().optional().default('https://api.minimax.io/v1'),
  DRILL_FALLBACK_URL: z.string().url().optional().default('https://api.together.xyz/v1'),
  DRILL_FALLBACK_KEY: z.string().optional().default(''),
  DRILL_MODEL: z.string().optional().default('MiniMax-M2.5'),
  DRILL_FALLBACK_MODEL: z.string().optional().default('MiniMaxAI/MiniMax-M2.5'),
});

export type DrillEnv = z.infer<typeof Phase3EnvSchema>;

/**
 * Validates and returns environment variables.
 * Exits the process with a clear error message if required vars are missing.
 * @returns Validated environment object
 */
export function validateEnv(): DrillEnv {
  const result = Phase3EnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    console.error(`\nDrill configuration error:\n${missing}\n`);
    console.error('Set DRILL_API_KEY to your MiniMax API key to get started.\n');
    process.exit(1);
  }
  return result.data;
}
```

---

## File: packages/cli/src/lib/render.ts

Complete terminal rendering. Every visual output Drill produces goes through this file.
No `console.log` calls outside of render.ts (except in tests).

```typescript
import chalk from 'chalk';
import boxen from 'boxen';
import ora, { type Ora } from 'ora';
import type { DrillResult, DrillError } from '../types.ts';

// ── Spinner ──────────────────────────────────────────────────────────────────

let activeSpinner: Ora | null = null;

/**
 * Starts the "Drilling..." spinner. Call stopSpinner() before any other output.
 */
export function startSpinner(text = 'Drilling...'): void {
  activeSpinner = ora({ text, color: 'magenta' }).start();
}

/**
 * Stops the spinner. Must be called before showThinking or showResult.
 */
export function stopSpinner(): void {
  activeSpinner?.stop();
  activeSpinner = null;
}

// ── Live thinking output ──────────────────────────────────────────────────────

/**
 * Renders a line of live thinking output from M2.5's <think> blocks.
 * Shown in dim gray with a ▸ prefix. Spinner must be stopped first.
 * @param text Thinking text chunk from stream
 */
export function showThinking(text: string): void {
  if (!text.trim()) return;
  // Show line by line — don't break mid-word
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      process.stdout.write(chalk.dim(`  ▸ ${line.trim()}\n`));
    }
  }
}

// ── Severity formatting ───────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: chalk.bgRed.white.bold,
  high: chalk.red.bold,
  medium: chalk.yellow.bold,
  low: chalk.blue,
} as const;

const SEVERITY_ICONS = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
} as const;

function formatSeverity(severity: DrillResult['severity']): string {
  const color = SEVERITY_COLORS[severity];
  return color(` ${SEVERITY_ICONS[severity]} ${severity.toUpperCase()} `);
}

function formatConfidence(confidence: number): string {
  if (confidence >= 75) return chalk.green.bold(`${confidence}%`);
  if (confidence >= 50) return chalk.yellow.bold(`${confidence}%`);
  return chalk.red.bold(`${confidence}%`);
}

// ── Result box ───────────────────────────────────────────────────────────────

/**
 * Renders the complete DrillResult as a formatted terminal box.
 * @param result The DrillResult to display
 * @param remaining Optional remaining run count to show below box
 */
export function showResult(result: DrillResult, remaining?: number): void {
  const lines: string[] = [];

  // Confidence + severity header
  lines.push(
    `${chalk.bold('Confidence:')} ${formatConfidence(result.confidence)}  ${chalk.bold('Severity:')} ${formatSeverity(result.severity)}`
  );
  lines.push('');

  // Cause
  lines.push(`${chalk.bold('Cause:')}`);
  lines.push(`  ${chalk.white(result.cause)}`);
  lines.push('');

  // Fix
  lines.push(`${chalk.bold.cyan('Fix:')}`);
  lines.push(`  ${chalk.cyan(result.fix)}`);

  // Evidence
  if (result.evidence.length > 0) {
    lines.push('');
    lines.push(`${chalk.bold('Evidence:')}`);
    for (const e of result.evidence.slice(0, 3)) {
      lines.push(`  ${chalk.dim('›')} ${chalk.dim(e.length > 120 ? e.slice(0, 117) + '...' : e)}`);
    }
  }

  // Alternative
  if (result.alternative) {
    lines.push('');
    lines.push(`${chalk.bold.dim('Alternative:')} ${chalk.dim(result.alternative)}`);
  }

  // Missing info
  if (result.missing && result.confidence < 60) {
    lines.push('');
    lines.push(`${chalk.bold.dim('For higher confidence:')} ${chalk.dim(result.missing)}`);
  }

  const box = boxen(lines.join('\n'), {
    title: chalk.hex('#2D1B69').bold('DRILL'),
    titleAlignment: 'left',
    padding: 1,
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: '#2D1B69',
  });

  console.log(box);

  // Run counter (Phase 3: show if DRILL_RUN_LIMIT set in env)
  if (remaining !== undefined) {
    if (remaining <= 5) {
      console.log(chalk.yellow(`\n  ${remaining} run${remaining === 1 ? '' : 's'} remaining this month · drill.dev/upgrade`));
    } else {
      console.log(chalk.dim(`\n  ${remaining} runs remaining this month`));
    }
  }
}

// ── Error display ────────────────────────────────────────────────────────────

/**
 * Renders a DrillError in a clear, actionable format.
 * @param error The DrillError to display
 */
export function showError(error: DrillError): void {
  const messages: Record<DrillError['code'], () => void> = {
    INVALID_KEY: () => {
      console.error(chalk.red.bold('\n  ✕ Invalid API key'));
      console.error(chalk.dim('  Set DRILL_API_KEY to your MiniMax API key.\n'));
    },
    LIMIT_REACHED: () => {
      console.error(chalk.yellow.bold('\n  ✕ Monthly run limit reached'));
      if (error.upgrade_url) {
        console.error(chalk.dim(`  Upgrade at: ${chalk.underline(error.upgrade_url)}\n`));
      }
    },
    PARSE_FAILED: () => {
      console.error(chalk.red.bold('\n  ✕ Failed to parse LLM response'));
      console.error(chalk.dim('  The model returned an unexpected format. Try again.\n'));
    },
    TIMEOUT: () => {
      console.error(chalk.red.bold('\n  ✕ Request timed out'));
      console.error(chalk.dim('  Use --timeout 120 to allow more time.\n'));
    },
    NETWORK: () => {
      console.error(chalk.red.bold('\n  ✕ Network error'));
      console.error(chalk.dim(`  ${error.message}\n`));
    },
    REDACTED_EMPTY: () => {
      console.error(chalk.yellow.bold('\n  ✕ Input was entirely redacted'));
      console.error(chalk.dim('  All content was identified as PII/secrets.'));
      console.error(chalk.dim('  Use --no-redact if the input contains no sensitive data.\n'));
    },
  };

  (messages[error.code] ?? (() => console.error(chalk.red(`\n  ✕ ${error.message}\n`))))();
}

// ── Status messages ───────────────────────────────────────────────────────────

/**
 * Shows how many lines are being analyzed. Shown before spinner starts.
 */
export function showInputInfo(lineCount: number, wasChunked: boolean): void {
  if (wasChunked) {
    console.log(chalk.dim(`  Reading ${lineCount.toLocaleString()} lines (truncated from larger input)...`));
  } else {
    console.log(chalk.dim(`  Reading ${lineCount.toLocaleString()} lines...`));
  }
}

/**
 * Shows verbose redaction stats when --verbose flag is used.
 */
export function showRedactStats(stats: import('../types.ts').RedactStats): void {
  if (stats.totalReplacements === 0) return;
  console.log(chalk.dim(`  Redacted: ${stats.totalReplacements} pattern${stats.totalReplacements === 1 ? '' : 's'} (${stats.charsRemoved} chars)`));
}
```

---

## File: packages/cli/src/commands/run.ts

The complete implementation of the default `drill [input]` command.

```typescript
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { redact, redactWithStats } from '../lib/redact.ts';
import { chunk } from '../lib/chunk.ts';
import { analyze } from '../lib/api.ts';
import { validateEnv } from '../lib/env.ts';
import {
  startSpinner, stopSpinner, showSpinner,
  showThinking, showResult, showError,
  showInputInfo, showRedactStats,
} from '../lib/render.ts';
import type { DrillError } from '../types.ts';

export interface RunOptions {
  noRedact?: boolean;
  lines?: string;
  context?: string;
  json?: boolean;
  ci?: boolean;
  local?: boolean;
  model?: string;
  verbose?: boolean;
  timeout?: string;
}

/**
 * Core run command. Reads log input from stdin or inline argument,
 * applies redaction and chunking, calls LLM API, renders result.
 *
 * @param inlineInput Optional inline text argument (alternative to stdin pipe)
 * @param options Commander option flags
 */
export async function runCommand(
  inlineInput: string | undefined,
  options: RunOptions,
): Promise<void> {
  const env = validateEnv();

  // ── 1. Read input ──────────────────────────────────────────────────────────
  let rawInput: string;

  if (inlineInput) {
    rawInput = inlineInput;
  } else if (!process.stdin.isTTY) {
    // Piped stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    rawInput = Buffer.concat(chunks).toString('utf8');
  } else {
    // No input provided and no pipe
    console.error('\nUsage: drill [input] OR pipe logs: cat error.log | drill\n');
    console.error('Examples:');
    console.error('  docker logs my-api 2>&1 | drill');
    console.error('  cat error.log | drill');
    console.error('  drill "NullPointerException at UserService.java:42"\n');
    process.exit(1);
  }

  if (!rawInput.trim()) {
    console.error('\n  Empty input. Nothing to analyze.\n');
    process.exit(1);
  }

  // ── 2. Apply line limit ────────────────────────────────────────────────────
  if (options.lines) {
    const n = parseInt(options.lines, 10);
    if (isNaN(n) || n < 1) {
      console.error(`\n  Invalid --lines value: ${options.lines}. Must be a positive integer.\n`);
      process.exit(1);
    }
    const allLines = rawInput.split('\n');
    rawInput = allLines.slice(-n).join('\n');
  }

  // ── 3. PII Redaction ───────────────────────────────────────────────────────
  let processedInput: string;

  if (options.noRedact) {
    processedInput = rawInput;
    if (options.verbose) {
      console.log('\x1b[2m  Redaction: disabled (--no-redact)\x1b[0m');
    }
  } else {
    const { redacted, stats } = redactWithStats(rawInput);
    processedInput = redacted;
    if (options.verbose) {
      showRedactStats(stats);
    }
    if (processedInput === '__DRILL_FULLY_REDACTED__') {
      showError({ code: 'REDACTED_EMPTY', message: 'All content was redacted' });
      process.exit(1);
    }
  }

  // ── 4. Chunking ────────────────────────────────────────────────────────────
  const chunkResult = chunk(processedInput);
  const finalInput = chunkResult.content;

  if (!options.json) {
    showInputInfo(chunkResult.resultLines, chunkResult.wasChunked);
  }

  // ── 5. Build context ───────────────────────────────────────────────────────
  let context: string | undefined;
  if (options.context) {
    // Context building implemented in Phase 4
    // In Phase 3: just include the directory path as a note
    context = `Source directory: ${options.context}`;
  }

  // ── 6. Call API ────────────────────────────────────────────────────────────
  let thinkingStarted = false;

  if (!options.json) {
    startSpinner();
  }

  const result = await analyze({
    input: finalInput,
    context,
    timeoutMs: options.timeout ? parseInt(options.timeout, 10) * 1000 : 90_000,
    onThinking: (text) => {
      if (!options.json) {
        if (!thinkingStarted) {
          stopSpinner();
          thinkingStarted = true;
        }
        showThinking(text);
      }
    },
    onResultChunk: () => undefined,
  });

  if (!options.json && !thinkingStarted) {
    stopSpinner();
  }

  // ── 7. Handle error ────────────────────────────────────────────────────────
  if ('code' in result) {
    const error = result as DrillError;
    if (options.json) {
      process.stderr.write(JSON.stringify({ error }) + '\n');
    } else {
      showError(error);
    }
    process.exit(error.code === 'LIMIT_REACHED' ? 2 : 1);
  }

  // ── 8. Output result ───────────────────────────────────────────────────────
  if (options.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    showResult(result);
  }

  // ── 9. CI mode exit code ───────────────────────────────────────────────────
  if (options.ci && result.confidence >= 50) {
    // Exit 1 = cause found (use as failure signal in pipelines)
    process.exit(1);
  }
}
```

---

## File: packages/cli/src/index.ts

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run.ts';

// __VERSION__ is injected by esbuild at build time
declare const __VERSION__: string;
const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const program = new Command();

program
  .name('drill')
  .description('AI-powered log diagnosis — pipe any log, get the root cause')
  .version(version, '-v, --version')
  .argument('[input]', 'Log text to analyze (alternative to stdin pipe)')
  .option('--no-redact', 'Disable PII redaction (use only for non-sensitive logs)')
  .option('--lines <n>', 'Analyze only the last N lines of input')
  .option('--context <dir>', 'Add source code context from directory')
  .option('--json', 'Output raw JSON result to stdout (status messages to stderr)')
  .option('--ci', 'CI mode: exit code 1 if cause found with confidence >= 50%')
  .option('--local', 'Use local Ollama model (nothing sent to API)')
  .option('--model <name>', 'Local model name when using --local (default: llama3.2)')
  .option('--verbose', 'Show redaction stats, timing, and debug info')
  .option('--timeout <seconds>', 'Request timeout in seconds (default: 90)')
  .action(async (input: string | undefined, options: Record<string, unknown>) => {
    await runCommand(input, options as Parameters<typeof runCommand>[1]);
  });

program
  .command('login')
  .description('Authenticate with drill.dev to unlock your account')
  .action(async () => {
    // Phase 7 — placeholder for now
    console.log('\ndrill login coming in a future phase.');
    console.log('Set DRILL_API_KEY environment variable to use Drill now.\n');
  });

program
  .command('logout')
  .description('Remove stored authentication token')
  .action(async () => {
    // Phase 7 — placeholder
    console.log('\ndrill logout: no stored token found.\n');
  });

program
  .command('status')
  .description('Show current plan, run count, and API key status')
  .action(async () => {
    // Phase 4
    console.log('\ndrill status: implement in Phase 4.\n');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n  Unexpected error: ${msg}\n`);
  process.exit(1);
});
```

---

## File: packages/cli/build.ts

```typescript
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node\n// drill-cli ' + pkg.version,
  },
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __ANON_KEY__: JSON.stringify(process.env['DRILL_ANON_KEY'] ?? ''),
  },
  external: ['fsevents'],  // macOS native — exclude from bundle
  minify: process.env['NODE_ENV'] === 'production',
  sourcemap: process.env['NODE_ENV'] !== 'production',
  logLevel: 'info',
});

console.log('Build complete: dist/index.js');
```

---

## Test file: packages/cli/test/commands/run.test.ts

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCommand } from '../../src/commands/run';

// Mock the API module — we test the command logic, not the LLM
vi.mock('../../src/lib/api', () => ({
  analyze: vi.fn().mockResolvedValue({
    cause: 'Database connection pool exhausted',
    confidence: 87,
    severity: 'high',
    evidence: ['Too many connections at 14:07'],
    fix: 'Increase DB_POOL_SIZE to 25',
    alternative: null,
    missing: null,
  }),
  loadApiConfig: vi.fn().mockReturnValue({
    primaryUrl: 'https://api.minimax.io/v1',
    primaryKey: 'test-key',
    primaryModel: 'MiniMax-M2.5',
    fallbackUrl: '',
    fallbackKey: '',
    fallbackModel: '',
  }),
}));

vi.mock('../../src/lib/render', () => ({
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
  showThinking: vi.fn(),
  showResult: vi.fn(),
  showError: vi.fn(),
  showInputInfo: vi.fn(),
  showRedactStats: vi.fn(),
}));

describe('runCommand', () => {
  beforeEach(() => {
    process.env['DRILL_API_KEY'] = 'test-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env['DRILL_API_KEY'];
  });

  it('processes inline input argument', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('Error: connection refused', {});
    expect(analyze).toHaveBeenCalledOnce();
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('Error: connection refused');
  });

  it('applies redaction by default', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('user@test.com failed at 192.168.1.1', {});
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).not.toContain('user@test.com');
    expect(callArg.input).not.toContain('192.168.1.1');
    expect(callArg.input).toContain('[EMAIL]');
    expect(callArg.input).toContain('[IP]');
  });

  it('skips redaction with --no-redact', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('user@test.com error', { noRedact: true });
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('user@test.com');
  });

  it('limits lines with --lines flag', async () => {
    const { analyze } = await import('../../src/lib/api');
    const input = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    await runCommand(input, { lines: '10' });
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const inputLines = callArg.input.split('\n');
    expect(inputLines.length).toBeLessThanOrEqual(10);
    expect(callArg.input).toContain('line 99');  // last line preserved
  });

  it('outputs JSON with --json flag', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand('test error', { json: true });
    const written = writeSpy.mock.calls.map(c => c[0] as string).join('');
    const parsed = JSON.parse(written);
    expect(parsed.cause).toBe('Database connection pool exhausted');
    writeSpy.mockRestore();
  });

  it('exits process 1 in --ci mode when confidence >= 50', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('does not exit in --ci mode when confidence < 50', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cause: 'Unknown',
      confidence: 30,
      severity: 'low',
      evidence: [],
      fix: 'Investigate further',
      alternative: null,
      missing: 'More logs needed',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('shows error and exits 1 on DrillError', async () => {
    const { analyze } = await import('../../src/lib/api');
    const { showError } = await import('../../src/lib/render');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 'NETWORK',
      message: 'Connection failed',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', {});
    expect(showError).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
```

---

## Exit criteria — Phase 3 is complete when ALL pass

```bash
# 1. Build succeeds
pnpm --filter cli build
# Expected: dist/index.js created, no errors

# 2. Binary runs and shows help
node packages/cli/dist/index.js --help
# Expected: Usage info with all flags listed

# 3. Basic pipe works end-to-end
echo "Error: ECONNREFUSED connecting to 127.0.0.1:5432" | \
  DRILL_API_KEY=your_key node packages/cli/dist/index.js
# Expected: thinking output streams, then result box appears with cause + fix

# 4. JSON flag works
echo "Error: out of memory" | \
  DRILL_API_KEY=your_key node packages/cli/dist/index.js --json | jq .cause
# Expected: quoted string with the identified cause

# 5. --no-redact flag works
echo "john@example.com failed" | \
  DRILL_API_KEY=your_key node packages/cli/dist/index.js --no-redact --json | \
  jq .cause
# Expected: non-empty cause string (input was passed unmodified)

# 6. --lines flag works
seq 1 1000 | sed 's/^/log line /' | \
  DRILL_API_KEY=your_key node packages/cli/dist/index.js --lines 20 --verbose
# Expected: "Reading 20 lines..." shown, not 1000

# 7. All tests pass including new Phase 3 tests
pnpm --filter cli test
# Expected: run.test.ts (8 tests) passing alongside Phase 1+2 tests

# 8. TypeScript zero errors
pnpm typecheck

# 9. Missing API key gives clear error (not a crash)
echo "test error" | node packages/cli/dist/index.js
# Expected: "DRILL_API_KEY is required" message, clean exit code 1

# 10. Invalid API key gives clear error
echo "test error" | DRILL_API_KEY=invalid node packages/cli/dist/index.js
# Expected: "Invalid API key" message, exit code 1
```

**After Phase 3: the core product works. This is your validation moment.
Run it against real logs from your own systems before moving to Phase 4.**
