/**
 * Terminal Rendering Module
 * 
 * All visual output for Drill goes through this module.
 * No console.log calls outside of render.ts (except in tests).
 */

import chalk from 'chalk';
import boxen from 'boxen';
import ora, { type Ora } from 'ora';
import type { DrillResult, DrillError } from '../types.js';

let activeSpinner: Ora | null = null;

export function startSpinner(text = 'Drilling...'): void {
  activeSpinner = ora({ text, color: 'magenta' }).start();
}

export function stopSpinner(): void {
  activeSpinner?.stop();
  activeSpinner = null;
}

export function showThinking(text: string): void {
  if (!text.trim()) return;
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.trim()) {
      process.stdout.write(chalk.dim(`  ▸ ${line.trim()}\n`));
    }
  }
}

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

export function showResult(result: DrillResult, remaining?: number): void {
  const lines: string[] = [];

  lines.push(
    `${chalk.bold('Confidence:')} ${formatConfidence(result.confidence)}  ${chalk.bold('Severity:')} ${formatSeverity(result.severity)}`
  );
  lines.push('');

  lines.push(`${chalk.bold('Cause:')}`);
  lines.push(`  ${chalk.white(result.cause)}`);
  lines.push('');

  lines.push(`${chalk.bold.cyan('Fix:')}`);
  lines.push(`  ${chalk.cyan(result.fix)}`);

  if (result.evidence.length > 0) {
    lines.push('');
    lines.push(`${chalk.bold('Evidence:')}`);
    for (const e of result.evidence.slice(0, 3)) {
      lines.push(`  ${chalk.dim('›')} ${chalk.dim(e.length > 120 ? e.slice(0, 117) + '...' : e)}`);
    }
  }

  if (result.alternative) {
    lines.push('');
    lines.push(`${chalk.bold.dim('Alternative:')} ${chalk.dim(result.alternative)}`);
  }

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

  if (remaining !== undefined) {
    if (remaining <= 5) {
      console.log(chalk.yellow(`\n  ${remaining} run${remaining === 1 ? '' : 's'} remaining this month · drill.dev/upgrade`));
    } else {
      console.log(chalk.dim(`\n  ${remaining} runs remaining this month`));
    }
  }
}

export function showError(error: DrillError): void {
  const messages: Record<DrillError['code'], () => void> = {
    INVALID_KEY: () => {
      console.error(chalk.red.bold('\n  ✕ Invalid API key'));
      if (error.message) {
        console.error(chalk.dim(`  ${error.message}\n`));
      } else {
        console.error(chalk.dim('  Run "drill login" or set DRILL_API_KEY to get started.\n'));
      }
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
    EMPTY_INPUT: () => {
      console.error(chalk.yellow.bold('\n  ✕ Empty input'));
      console.error(chalk.dim('  Nothing to analyze.\n'));
    },
    CHUNK_FAILED: () => {
      console.error(chalk.red.bold('\n  ✕ Chunking failed'));
      console.error(chalk.dim(`  ${error.message}\n`));
    },
    API_ERROR: () => {
      console.error(chalk.red.bold('\n  ✕ API error'));
      console.error(chalk.dim(`  ${error.message}\n`));
    },
    SERVER_ERROR: () => {
      console.error(chalk.red.bold('\n  ✕ Server error'));
      console.error(chalk.dim(`  ${error.message}\n`));
    },
    NO_KEY: () => {
      console.error(chalk.red.bold('\n  ✕ No API key configured'));
      console.error(chalk.dim(`  ${error.message}\n`));
      console.error(chalk.dim('  Or run: ' + chalk.cyan('drill setup') + '\n'));
    },
    PROVIDER_ERROR: () => {
      console.error(chalk.red.bold('\n  ✕ Provider error'));
      console.error(chalk.dim(`  ${error.message}\n`));
    },
  };

  (messages[error.code] ?? (() => console.error(chalk.red(`\n  ✕ ${error.message}\n`))))();
}

export function showInputInfo(lineCount: number, wasChunked: boolean): void {
  if (wasChunked) {
    console.log(chalk.dim(`  Reading ${lineCount.toLocaleString()} lines (truncated from larger input)...`));
  } else {
    console.log(chalk.dim(`  Reading ${lineCount.toLocaleString()} lines...`));
  }
}

export function showRedactStats(stats: import('../types.js').RedactStats): void {
  if (stats.totalReplacements === 0) return;
  console.log(chalk.dim(`  Redacted: ${stats.totalReplacements} pattern${stats.totalReplacements === 1 ? '' : 's'} (${stats.charsRemoved} chars)`));
}
