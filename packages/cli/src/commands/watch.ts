/**
 * Watch Command Module
 * 
 * drill --watch <filepath>
 * 
 * Uses chokidar to watch a file for error patterns, then runs
 * the same analysis flow as run.ts with debounce and per-file cooldown.
 * 
 * Error detection: /\b(ERROR|FATAL|Exception|Traceback|panic|CRITICAL|SEVERE)\b/i
 * Debounce: 500ms per file (wait for burst writes to finish)
 * Cooldown: 30s per file (prevent spam)
 * Ctrl+C: clean shutdown with session stats
 */

import { statSync, readFileSync } from 'node:fs';
import { watch as fsWatch, type FSWatcher } from 'chokidar';
import chalk from 'chalk';
import { preprocess } from '../lib/preprocess.js';
import { analyze } from '../lib/api.js';
import { showThinking, showResult, showError } from '../lib/render.js';
import { getApiKey, loadAuth } from '../lib/auth.js';
import type { DrillError } from '../types.js';

const ERROR_REGEX = /\b(ERROR|FATAL|Exception|Traceback|panic|CRITICAL|SEVERE)\b/i;
const DEBOUNCE_MS = 500;
const COOLDOWN_MS = 30_000;
const LAST_LINES = 200;

export interface WatchOptions {
  watch: string;
  noRedact?: boolean;
  json?: boolean;
  local?: boolean;
  model?: string;
  verbose?: boolean;
  timeout?: string;
}

function parseTimeoutMs(timeoutSeconds: string | undefined): number {
  if (timeoutSeconds === undefined) return 90_000;

  const seconds = parseInt(timeoutSeconds, 10);
  if (isNaN(seconds) || seconds < 1) {
    console.error(`\n  Invalid --timeout value: ${timeoutSeconds}. Must be a positive integer.\n`);
    process.exit(1);
  }

  return seconds * 1000;
}

/**
 * Watches a file for error patterns and runs analysis on detected errors.
 */
export async function watchCommand(options: WatchOptions): Promise<void> {
  const filePath = options.watch;
  const apiKey = getApiKey();
  const auth = loadAuth();
  const timeoutMs = parseTimeoutMs(options.timeout);
  const localModel = options.local ? (options.model ?? auth?.localModel ?? 'llama3.2') : undefined;

  if (options.model && !options.local) {
    console.error('\n  --model can only be used together with --local.\n');
    process.exit(1);
  }

  if (!options.local && !apiKey) {
    console.error(`\n  ${chalk.red('✕')} No API key configured.\n`);
    console.error('  Run "drill login" or set DRILL_API_KEY to use drill --watch.\n');
    process.exit(1);
  }

  if (!filePath) {
    console.error('\n  Error: --watch requires a file path.\n');
    console.error('  Usage: drill --watch /var/log/app.log\n');
    process.exit(1);
  }

  let fileStat;
  try {
    fileStat = statSync(filePath);
  } catch {
    console.error(`\n  ${chalk.red('✕')} File not found: ${filePath}\n`);
    process.exit(1);
  }

  if (!fileStat.isFile()) {
    console.error(`\n  ${chalk.red('✕')} Not a file: ${filePath}\n`);
    process.exit(1);
  }

  const cooldowns = new Map<string, number>();
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let totalAnalyses = 0;
  let watcher: FSWatcher | null = null;

  async function readLastLines(fp: string): Promise<string> {
    try {
      const content = readFileSync(fp, 'utf8');
      const lines = content.split('\n');
      return lines.slice(-LAST_LINES).join('\n');
    } catch {
      return '';
    }
  }

  function detectErrors(content: string): boolean {
    return ERROR_REGEX.test(content);
  }

  async function runAnalysis(filePath: string): Promise<void> {
    const now = Date.now();
    const lastRun = cooldowns.get(filePath) ?? 0;
    
    if (now - lastRun < COOLDOWN_MS) {
      return;
    }

    const content = await readLastLines(filePath);
    if (!detectErrors(content)) return;

    cooldowns.set(filePath, now);
    totalAnalyses++;

    const separator = `${chalk.dim('─'.repeat(60))}`;
    
    if (!options.json) {
      console.log(`\n${separator}`);
      console.log(`  ${chalk.bold('drill')} ${chalk.dim(`// ${filePath}`)}`);
      console.log(chalk.dim(`  ${new Date().toLocaleTimeString()}\n`));
    }

    const preprocessed = preprocess(content, !options.noRedact);
    if (preprocessed.content === '__DRILL_FULLY_REDACTED__') {
      return;
    }
    const finalInput = preprocessed.content;

    let thinkingStarted = false;

    const analyzeOptions: Parameters<typeof analyze>[0] = {
      input: finalInput,
      timeoutMs,
      onThinking: (text) => {
        if (!options.json) {
          if (!thinkingStarted) {
            thinkingStarted = true;
          }
          showThinking(text);
        }
      },
      onResultChunk: () => undefined,
    };

    if (options.local) {
      analyzeOptions.providerOverride = 'ollama';
      if (localModel) {
        analyzeOptions.providerModelOverride = localModel;
      }
    }

    const result = await analyze(analyzeOptions);

    if ('code' in result) {
      const error = result as DrillError;
      if (options.json) {
        process.stderr.write(JSON.stringify({ error }) + '\n');
      } else {
        showError(error);
      }
      return;
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      showResult(result);
    }

    if (!options.json) {
      console.log(`\n${separator}`);
    }
  }

  async function onFileChange(fp: string): Promise<void> {
    const existingTimer = debounceTimers.get(fp);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      debounceTimers.delete(fp);
      await runAnalysis(fp);
    }, DEBOUNCE_MS);

    debounceTimers.set(fp, timer);
  }

  console.log(`\n  ${chalk.bold('Watching:')} ${chalk.dim(filePath)}`);
  console.log(`  ${chalk.bold('Pattern:')} ${chalk.dim('ERROR|FATAL|Exception|Traceback|panic|CRITICAL|SEVERE')}`);
  const cooldownSecs = COOLDOWN_MS / 1000;
  console.log(`  ${chalk.bold('Debounce:')} ${chalk.dim(`${DEBOUNCE_MS}ms`)}   ${chalk.bold('Cooldown:')} ${chalk.dim(`${cooldownSecs}s`)}`);
  console.log(`\n  ${chalk.dim('Press Ctrl+C to stop.')}\n`);

  watcher = fsWatch(filePath, {
    persistent: true,
    usePolling: false,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  watcher.on('change', async (fp) => {
    await onFileChange(fp);
  });

  watcher.on('error', async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ${chalk.red('✕')} Watch error: ${msg}\n`);
    await shutdown();
    process.exit(1);
  });

  async function shutdown(): Promise<void> {
    // Clear all debounce timers
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();

    // Close watcher
    if (watcher) {
      await watcher.close();
      watcher = null;
    }

    // Print session summary
    console.log(`\n\n  ${chalk.bold('Session Summary:')}`);
    console.log(`  Files watched: 1`);
    console.log(`  Analyses run:   ${totalAnalyses}`);
    console.log(`  Duration:       ${chalk.dim(`${new Date().toLocaleTimeString()}`)}\n`);
  }

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });
}
