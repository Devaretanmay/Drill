# Phase 4 — Power CLI features: watch, context, config, status

## What this phase builds

All remaining CLI commands and flags beyond the core `drill` command.
After this phase the CLI is feature-complete as a standalone tool.

## Depends on

Phases 1–3 complete. `drill [input]` works end-to-end.

## Scope

- `packages/cli/src/commands/watch.ts` — `drill --watch <file>`
- `packages/cli/src/commands/status.ts` — `drill status`
- `packages/cli/src/commands/config.ts` — `drill config`
- `packages/cli/src/lib/context.ts` — `--context <dir>` flag full implementation
- Updated `packages/cli/src/index.ts` — wire up all new commands + flags
- Updated `packages/cli/src/commands/run.ts` — complete `--context` integration
- `packages/cli/test/commands/watch.test.ts`
- `packages/cli/test/context.test.ts`

---

## File: packages/cli/src/lib/context.ts

```typescript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.nyc_output', '__pycache__', '.pytest_cache',
  'venv', '.venv', 'env', '.env', 'vendor', '.cache',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.cs', '.cpp', '.c', '.h', '.swift', '.php',
  '.yaml', '.yml', '.toml', '.json', '.env.example',
]);

const MAX_FILE_SIZE = 50_000;    // 50KB per file
const MAX_TOTAL_CONTEXT = 50_000; // 50KB total context
const MAX_FILES = 5;              // Top 5 most relevant files
const MAX_FILE_LINES = 100;       // First 100 lines per file
const MAX_TREE_DEPTH = 4;

export interface ContextResult {
  fileTree: string;
  files: Array<{ path: string; content: string; score: number }>;
  totalChars: number;
}

/**
 * Builds codebase context from a directory for inclusion in the LLM prompt.
 * Walks the directory, scores files by relevance to the log input,
 * and returns the top 5 most relevant files plus a directory tree.
 *
 * @param dir Path to source directory
 * @param logInput The log input being analyzed (used for relevance scoring)
 * @returns ContextResult with file tree and relevant file contents
 */
export function buildContext(dir: string, logInput: string): ContextResult {
  const keywords = extractKeywords(logInput);
  const allFiles = walkDirectory(dir);
  const scored = scoreFiles(allFiles, dir, keywords);
  const topFiles = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FILES)
    .filter(f => f.score > 0);

  const files: ContextResult['files'] = [];
  let totalChars = 0;

  for (const f of topFiles) {
    if (totalChars >= MAX_TOTAL_CONTEXT) break;
    try {
      const stat = statSync(f.path);
      if (stat.size > MAX_FILE_SIZE) continue;

      const content = readFileSync(f.path, 'utf8');
      const lines = content.split('\n').slice(0, MAX_FILE_LINES);
      const truncated = lines.join('\n');
      const relativePath = relative(dir, f.path);

      files.push({ path: relativePath, content: truncated, score: f.score });
      totalChars += truncated.length;
    } catch {
      // Skip unreadable files
    }
  }

  return {
    fileTree: buildFileTree(dir, MAX_TREE_DEPTH),
    files,
    totalChars,
  };
}

/**
 * Formats the ContextResult into a string for inclusion in the LLM prompt.
 */
export function formatContext(ctx: ContextResult): string {
  const parts: string[] = [];

  parts.push('=== CODEBASE CONTEXT ===');
  parts.push('Project structure:');
  parts.push(ctx.fileTree);

  if (ctx.files.length > 0) {
    parts.push('\nRelevant source files:');
    for (const f of ctx.files) {
      parts.push(`\n--- ${f.path} ---`);
      parts.push(f.content);
    }
  }

  parts.push('=== END CODEBASE CONTEXT ===');
  return parts.join('\n');
}

function extractKeywords(logInput: string): Set<string> {
  const keywords = new Set<string>();

  // File paths mentioned in stack traces
  const pathMatches = logInput.matchAll(/(?:at\s+)?[\w.]+\s+\(?([\w/.]+\.\w+):\d+:\d+\)?/g);
  for (const match of pathMatches) {
    const parts = (match[1] ?? '').split('/');
    for (const part of parts) {
      if (part.includes('.')) keywords.add(part.toLowerCase());
    }
  }

  // Class/function names in stack traces
  const classMatches = logInput.matchAll(/at\s+([\w.]+)\.([\w]+)\s/g);
  for (const match of classMatches) {
    if (match[1]) keywords.add(match[1].toLowerCase());
    if (match[2]) keywords.add(match[2].toLowerCase());
  }

  // Python module names
  const pyMatches = logInput.matchAll(/File "([^"]+\.py)"/g);
  for (const match of pyMatches) {
    const name = (match[1] ?? '').split('/').pop()?.replace('.py', '') ?? '';
    if (name) keywords.add(name.toLowerCase());
  }

  // Module/import names
  const importMatches = logInput.matchAll(/(?:import|from|require)\s+['"]?([\w./]+)/g);
  for (const match of importMatches) {
    keywords.add((match[1] ?? '').toLowerCase());
  }

  return keywords;
}

function scoreFiles(
  files: string[],
  baseDir: string,
  keywords: Set<string>,
): Array<{ path: string; score: number }> {
  return files.map(filePath => {
    const relativePath = relative(baseDir, filePath).toLowerCase();
    const basename = relativePath.split('/').pop() ?? '';
    let score = 0;

    for (const keyword of keywords) {
      if (basename.includes(keyword)) score += 3;
      else if (relativePath.includes(keyword)) score += 1;
    }

    return { path: filePath, score };
  });
}

function walkDirectory(dir: string, maxDepth = MAX_TREE_DEPTH, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.env.example') continue;
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (IGNORED_DIRS.has(entry)) continue;
      files.push(...walkDirectory(fullPath, maxDepth, depth + 1));
    } else if (CODE_EXTENSIONS.has(extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildFileTree(dir: string, maxDepth: number): string {
  const lines: string[] = [];

  function walk(currentDir: string, prefix: string, depth: number): void {
    if (depth > maxDepth) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir).sort();
    } catch {
      return;
    }

    const filtered = entries.filter(e => {
      if (e.startsWith('.') && e !== '.env.example') return false;
      if (IGNORED_DIRS.has(e)) return false;
      return true;
    });

    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i] ?? '';
      const isLast = i === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      const fullPath = join(currentDir, entry);

      lines.push(prefix + connector + entry);

      try {
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath, nextPrefix, depth + 1);
        }
      } catch {
        // Skip
      }
    }
  }

  const dirName = dir.split('/').pop() ?? dir;
  lines.push(dirName + '/');
  walk(dir, '', 0);
  return lines.join('\n');
}
```

---

## File: packages/cli/src/commands/watch.ts

```typescript
import chokidar from 'chokidar';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { runCommand, type RunOptions } from './run.ts';

const ERROR_PATTERN = /\b(ERROR|FATAL|Exception|Traceback|panic:|CRITICAL|SEVERE|Killed|OOM|segfault|FAIL)\b/i;
const MIN_ANALYSIS_INTERVAL_MS = 30_000; // 30s min between auto-analyses
const DEBOUNCE_MS = 500;

/**
 * Watches a log file and automatically runs Drill analysis when error
 * patterns are detected. Prints results inline.
 *
 * @param filePath Path to the log file to watch
 * @param options Run options to pass through to analyze
 */
export async function watchCommand(filePath: string, options: RunOptions): Promise<void> {
  console.log(chalk.dim(`\n  Watching ${filePath} for errors...`));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

  let lastAnalysis = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let analysisCount = 0;

  const watcher = chokidar.watch(filePath, {
    persistent: true,
    usePolling: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on('error', (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`\n  Watch error: ${msg}\n`));
  });

  watcher.on('change', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const now = Date.now();
      if (now - lastAnalysis < MIN_ANALYSIS_INTERVAL_MS) return;

      // Read last 200 lines
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        return;
      }

      const lines = content.split('\n');
      const tail = lines.slice(-200).join('\n');

      if (!ERROR_PATTERN.test(tail)) return;

      lastAnalysis = now;
      analysisCount++;

      console.log(chalk.dim(`\n  ─── Auto-analysis #${analysisCount} ───`));
      await runCommand(tail, { ...options });
      console.log(chalk.dim(`  ─────────────────────────\n`));
    }, DEBOUNCE_MS);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    watcher.close().catch(() => undefined);
    console.log(chalk.dim(`\n  Stopped watching. ${analysisCount} auto-analys${analysisCount === 1 ? 'is' : 'es'} run.\n`));
    process.exit(0);
  });

  // Keep process alive
  await new Promise<never>(() => undefined);
}
```

---

## File: packages/cli/src/commands/status.ts

```typescript
import chalk from 'chalk';
import { validateEnv } from '../lib/env.ts';

/**
 * Shows current Drill configuration status.
 * In Phase 3-5 (no auth): shows env-based config.
 * In Phase 7+ (auth): shows account info from stored token.
 */
export async function statusCommand(): Promise<void> {
  const env = validateEnv();

  const keyDisplay = env.DRILL_API_KEY.length > 8
    ? `${env.DRILL_API_KEY.slice(0, 8)}...${env.DRILL_API_KEY.slice(-4)}`
    : '(set)';

  console.log('\n' + chalk.bold('  Drill status'));
  console.log(chalk.dim('  ─────────────────────────────'));
  console.log(`  API key:   ${chalk.green(keyDisplay)}`);
  console.log(`  API URL:   ${chalk.dim(env.DRILL_API_URL)}`);
  console.log(`  Model:     ${chalk.dim(env.DRILL_MODEL)}`);
  console.log(`  Fallback:  ${env.DRILL_FALLBACK_KEY ? chalk.green('configured') : chalk.dim('not set')}`);
  console.log(chalk.dim('  ─────────────────────────────'));
  console.log(chalk.dim('\n  Run `drill --help` for usage.\n'));
}
```

---

## File: packages/cli/src/commands/config.ts

```typescript
import chalk from 'chalk';

interface ConfigOptions {
  set?: string;
  get?: string;
  list?: boolean;
}

const CONFIGURABLE_KEYS = ['model', 'apiUrl', 'timeout', 'redact'] as const;

/**
 * Get or set Drill configuration values.
 * Phase 3-5: Shows environment variable instructions.
 * Phase 7+: Reads/writes from ~/.drill/config via Conf.
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  if (options.set) {
    const [key, value] = options.set.split('=');
    if (!key || !value) {
      console.error('\n  Usage: drill config --set key=value\n');
      console.error('  Example: drill config --set timeout=120\n');
      process.exit(1);
    }
    if (!CONFIGURABLE_KEYS.includes(key as typeof CONFIGURABLE_KEYS[number])) {
      console.error(`\n  Unknown config key: ${key}`);
      console.error(`  Valid keys: ${CONFIGURABLE_KEYS.join(', ')}\n`);
      process.exit(1);
    }
    // Phase 7+: persist to ~/.drill/config
    // Phase 3-5: instruct user to set env var
    console.log(chalk.dim(`\n  To set ${key}, add to your shell profile:`));
    console.log(chalk.cyan(`  export DRILL_${key.toUpperCase()}=${value}\n`));
    return;
  }

  if (options.get) {
    const envKey = `DRILL_${options.get.toUpperCase()}`;
    const value = process.env[envKey];
    if (value) {
      console.log(`\n  ${options.get} = ${value}\n`);
    } else {
      console.log(chalk.dim(`\n  ${options.get} is not set. (env: ${envKey})\n`));
    }
    return;
  }

  // Default: list all config
  console.log('\n' + chalk.bold('  Drill configuration'));
  console.log(chalk.dim('  ─────────────────────────────'));
  for (const key of CONFIGURABLE_KEYS) {
    const envKey = `DRILL_${key.toUpperCase()}`;
    const value = process.env[envKey];
    console.log(`  ${key.padEnd(12)} ${value ? chalk.green(value) : chalk.dim('(default)')}`);
  }
  console.log(chalk.dim('  ─────────────────────────────\n'));
}
```

---

## Updated: packages/cli/src/index.ts

Add these commands to the existing index.ts from Phase 3:

```typescript
// Add to existing index.ts — new command registrations

// --watch flag on the main command
program
  .option('--watch <file>', 'Watch a log file and auto-analyze on error detection');

// Intercept --watch in the main action (before calling runCommand)
// Inside .action():
//   if (options.watch) {
//     await watchCommand(options.watch, options);
//     return;
//   }

// status command
program
  .command('status')
  .description('Show current plan, run count, and API key status')
  .action(async () => {
    const { statusCommand } = await import('./commands/status.ts');
    await statusCommand();
  });

// config command
program
  .command('config')
  .description('Get or set Drill configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .option('--get <key>', 'Get a configuration value')
  .option('--list', 'List all configuration values')
  .action(async (options: { set?: string; get?: string; list?: boolean }) => {
    const { configCommand } = await import('./commands/config.ts');
    await configCommand(options);
  });
```

Also update `runCommand` in `run.ts` to fully implement `--context`:

```typescript
// Replace the Phase 3 placeholder context handling with:
if (options.context) {
  const { buildContext, formatContext } = await import('../lib/context.ts');
  const ctxResult = buildContext(options.context, finalInput);
  context = formatContext(ctxResult);
  if (options.verbose) {
    console.log(chalk.dim(`  Context: ${ctxResult.files.length} relevant files from ${options.context}`));
  }
}
```

---

## Test file: packages/cli/test/context.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildContext, formatContext } from '../src/lib/context';

const TEST_DIR = '/tmp/drill-test-context';

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'src', 'services'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'node_modules', 'express'), { recursive: true });

  writeFileSync(join(TEST_DIR, 'src', 'UserService.ts'),
    'export class UserService { async getUser() { return null; } }');
  writeFileSync(join(TEST_DIR, 'src', 'OrderService.ts'),
    'export class OrderService { async createOrder() {} }');
  writeFileSync(join(TEST_DIR, 'src', 'services', 'database.ts'),
    'export const db = { query: async () => {} }');
  writeFileSync(join(TEST_DIR, 'node_modules', 'express', 'index.js'),
    'module.exports = {};');
  writeFileSync(join(TEST_DIR, '.env.example'),
    'DB_HOST=localhost\nDB_PORT=5432');
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('buildContext', () => {
  it('excludes node_modules', () => {
    const result = buildContext(TEST_DIR, 'error in UserService');
    const paths = result.files.map(f => f.path);
    expect(paths.every(p => !p.includes('node_modules'))).toBe(true);
  });

  it('scores files matching log keywords higher', () => {
    const result = buildContext(TEST_DIR, 'Error at UserService.ts:42');
    const userServiceFile = result.files.find(f => f.path.includes('UserService'));
    expect(userServiceFile).toBeDefined();
    expect(userServiceFile!.score).toBeGreaterThan(0);
  });

  it('includes file tree', () => {
    const result = buildContext(TEST_DIR, 'error');
    expect(result.fileTree).toContain('src');
    expect(result.fileTree).toContain('UserService.ts');
  });

  it('does not include files exceeding MAX_FILES', () => {
    const result = buildContext(TEST_DIR, 'generic error');
    expect(result.files.length).toBeLessThanOrEqual(5);
  });

  it('includes .env.example files', () => {
    const result = buildContext(TEST_DIR, 'configuration error');
    const tree = result.fileTree;
    expect(tree).toContain('.env.example');
  });
});

describe('formatContext', () => {
  it('wraps in CODEBASE CONTEXT markers', () => {
    const result = buildContext(TEST_DIR, 'UserService error');
    const formatted = formatContext(result);
    expect(formatted).toContain('=== CODEBASE CONTEXT ===');
    expect(formatted).toContain('=== END CODEBASE CONTEXT ===');
  });

  it('includes project structure section', () => {
    const result = buildContext(TEST_DIR, 'error');
    const formatted = formatContext(result);
    expect(formatted).toContain('Project structure:');
  });
});
```

---

## Exit criteria — Phase 4 is complete when ALL pass

```bash
# 1. All existing tests still pass
pnpm --filter cli test
# Expected: all Phase 1+2+3 tests plus new Phase 4 tests

# 2. TypeScript zero errors
pnpm typecheck

# 3. --watch flag starts watching
echo "test" > /tmp/drill-test.log
DRILL_API_KEY=your_key node packages/cli/dist/index.js --watch /tmp/drill-test.log &
WATCH_PID=$!
sleep 1
echo "ERROR: connection refused to database" >> /tmp/drill-test.log
sleep 5
kill $WATCH_PID
# Expected: auto-analysis runs when ERROR line is appended

# 4. --context flag builds and includes context
mkdir -p /tmp/drill-src && echo "class UserService { connect() {} }" > /tmp/drill-src/UserService.ts
echo "NullPointerException in UserService" | \
  DRILL_API_KEY=your_key node packages/cli/dist/index.js \
  --context /tmp/drill-src --verbose
# Expected: "Context: 1 relevant files from /tmp/drill-src" in verbose output

# 5. drill status shows config
DRILL_API_KEY=test123 node packages/cli/dist/index.js status
# Expected: masked key and config values shown

# 6. drill config --list shows options
DRILL_API_KEY=test123 node packages/cli/dist/index.js config --list
# Expected: table of configurable keys

# 7. Build succeeds with all new commands
pnpm --filter cli build
```
