/**
 * Run Command Module
 * 
 * Core `drill [input]` command implementation.
 * Reads log input from stdin or inline argument, applies redaction and chunking,
 * builds context from source directory, calls LLM API, and renders result.
 */

import chalk from 'chalk';
import { preprocess, preprocessVerbose } from '../lib/preprocess.js';
import { buildContext } from '../lib/context.js';
import { analyze } from '../lib/api.js';
import {
  startSpinner, stopSpinner, showThinking, showResult, showError,
  showInputInfo, showRedactStats,
} from '../lib/render.js';
import { loadAuth, isAuthenticated, checkAndIncrementRun } from '../lib/auth.js';
import type { DrillError } from '../types.js';

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

function parseTimeoutMs(timeoutSeconds: string | undefined): number {
  if (timeoutSeconds === undefined) return 90_000;

  const seconds = parseInt(timeoutSeconds, 10);
  if (isNaN(seconds) || seconds < 1) {
    console.error(`\n  Invalid --timeout value: ${timeoutSeconds}. Must be a positive integer.\n`);
    process.exit(1);
  }

  return seconds * 1000;
}

export async function runCommand(
  inlineInput: string | undefined,
  options: RunOptions,
): Promise<void> {
  if (options.model && !options.local) {
    console.error('\n  --model can only be used together with --local.\n');
    process.exit(1);
  }

  // Auth check
  if (!isAuthenticated()) {
    console.error(chalk.yellow('\n  Not logged in. Run: drill login\n'));
    process.exit(1);
  }

  // Run limit check
  const limitCheck = await checkAndIncrementRun();

  if (!limitCheck.allowed) {
    showError({
      code: 'LIMIT_REACHED',
      message: `Weekly limit reached (${limitCheck.runsWeek}/${limitCheck.limit})`,
    });
    if (limitCheck.weekReset) {
      console.log(chalk.dim(`  Resets: ${limitCheck.weekReset}\n`));
    }
    process.exit(2);
  }

  // Warn when approaching limit
  const pct = limitCheck.runsWeek / limitCheck.limit;
  if (pct >= 0.9 && limitCheck.limit < 999999) {
    console.log(chalk.yellow(
      `  ${limitCheck.runsWeek}/${limitCheck.limit} analyses used this week\n`
    ));
  }

  const auth = loadAuth();
  if (!auth?.provider && !process.env['DRILL_API_KEY']) {
    console.error('\n  Drill is not configured.\n');
    console.error('  Run the setup wizard to configure your LLM provider:');
    console.error('  ' + chalk.cyan('drill setup') + '\n');
    process.exit(1);
  }

  let rawInput: string;

  if (inlineInput) {
    rawInput = inlineInput;
  } else if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    rawInput = Buffer.concat(chunks).toString('utf8');
  } else {
    console.error('\nUsage: drill [input] OR pipe logs: cat error.log | drill\n');
    console.error('Examples:');
    console.error('  docker logs my-api 2>&1 | drill');
    console.error('  cat error.log | drill');
    console.error('  drill "NullPointerException at UserService.java:42"\n');
    process.exit(1);
  }

  if (!rawInput.trim()) {
    showError({ code: 'EMPTY_INPUT', message: 'Empty input. Nothing to analyze.' });
    process.exit(1);
  }

  if (options.lines) {
    const n = parseInt(options.lines, 10);
    if (isNaN(n) || n < 1) {
      console.error(`\n  Invalid --lines value: ${options.lines}. Must be a positive integer.\n`);
      process.exit(1);
    }
    const allLines = rawInput.split('\n');
    rawInput = allLines.slice(-n).join('\n');
  }

  // Build context from source directory (before redaction — we want raw file contents)
  let contextBlock = '';
  if (options.context) {
    if (!options.json) {
      console.log(chalk.dim(`  Building context from ${options.context}...`));
    }
    contextBlock = await buildContext(options.context, rawInput);
  }

  const doRedact = !options.noRedact;

  const preprocessed = options.verbose
    ? preprocessVerbose(rawInput, doRedact)
    : preprocess(rawInput, doRedact);

  const finalInput = preprocessed.content;

  if (options.verbose) {
    const verboseResult = preprocessed as ReturnType<typeof preprocessVerbose>;
    if (verboseResult.redactStats.totalReplacements > 0) {
      showRedactStats(verboseResult.redactStats);
    }
    if (!preprocessed.filterResult.usedFallback) {
      console.log(chalk.dim(
        `  Filtered: ${preprocessed.filterResult.matchedLineCount} signal lines found, ` +
        `${preprocessed.filterResult.removedHealthcheckLineCount} healthcheck lines removed`
      ));
    }
    if (preprocessed.chunkResult.wasChunked) {
      console.log(chalk.dim(
        `  Chunked: ${preprocessed.chunkResult.originalLines} → ${preprocessed.chunkResult.resultLines} lines`
      ));
    }
  }

  if (doRedact && finalInput === '__DRILL_FULLY_REDACTED__') {
    showError({ code: 'REDACTED_EMPTY', message: 'All content was redacted' });
    process.exit(1);
  }

  if (!options.json) {
    showInputInfo(preprocessed.chunkResult.resultLines, preprocessed.chunkResult.wasChunked);
  }

  let thinkingStarted = false;
  const timeoutMs = parseTimeoutMs(options.timeout);
  const localModel = options.local ? (options.model ?? auth?.localModel ?? 'llama3.2') : undefined;

  const analyzeOptions: Parameters<typeof analyze>[0] = {
    input: finalInput,
    timeoutMs,
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
  };

  if (contextBlock) {
    analyzeOptions.context = contextBlock;
  }

  if (options.local && localModel) {
    analyzeOptions.providerOverride = 'ollama';
    analyzeOptions.providerModelOverride = localModel;
  }

  if (!options.json) {
    startSpinner();
  }

  const result = await analyze(analyzeOptions);

  if (!options.json && !thinkingStarted) {
    stopSpinner();
  }

  if ('code' in result) {
    const error = result as DrillError;
    if (options.json) {
      process.stderr.write(JSON.stringify({ error }) + '\n');
    } else {
      showError(error);
    }
    process.exit(error.code === 'LIMIT_REACHED' ? 2 : 1);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    showResult(result);
  }

  if (options.ci && result.confidence >= 50) {
    process.exit(1);
  }
}
