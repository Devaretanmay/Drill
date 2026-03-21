/**
 * Terminal Rendering Module
 *
 * All visual output for Drill goes through this module.
 * No console.log calls outside of render.ts (except in tests).
 */

import chalk from 'chalk';
import type { DrillResult, DrillError } from '../types.js';

export function showThinking(text: string): void {
  if (!text.trim()) return;
  const firstLine = text.split('\n')[0]?.trim().slice(0, 60) ?? '';
  const dim = chalk.hex('#484F58');
  process.stdout.write(`\r  ${dim('· ')}${dim(firstLine)}`);
}

export function clearThinking(): void {
  const cols = process.stdout.columns ?? 80;
  process.stdout.write(`\r${' '.repeat(cols)}\r`);
}

export interface ShowResultMeta {
  provider?: string;
  model?: string;
  elapsedMs?: number;
  runsWeek?: number;
  weekLimit?: number;
}

export function showResult(result: DrillResult, meta?: ShowResultMeta): void {
  clearThinking();
  const dim = chalk.hex('#484F58');
  const footerDim = chalk.hex('#30363D');
  const causeColor = chalk.hex('#E6EDF3');
  const fixColor = chalk.hex('#2DD4BF');
  const fixBorder = chalk.hex('#0D9488');
  const confidenceColor = chalk.hex('#3FB950').bold;

  // Severity badge
  const severityBadge = (s: DrillResult['severity']) => {
    switch (s) {
      case 'critical':
        return chalk.hex('#EF5350').bold(' CRITICAL ');
      case 'high':
        return chalk.hex('#FF9800').bold(' HIGH ');
      case 'medium':
        return chalk.hex('#FFC107').bold(' MEDIUM ');
      case 'low':
        return chalk.hex('#64B5F6')(' LOW ');
    }
  };

  // Wrap text at given width
  const wrap = (text: string, width: number): string[] => {
    if (text.length <= width) return [text];
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if (current.length + word.length + 1 <= width) {
        current += (current ? ' ' : '') + word;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  // 1. Empty line
  console.log('');

  // 2. Severity badge + confidence
  console.log(
    severityBadge(result.severity) + '  ' +
    dim('confidence ') +
    confidenceColor(`${result.confidence}%`)
  );

  // 3. Empty line
  console.log('');

  // 4. Cause
  console.log(dim('  cause'));
  const causeLines = wrap(result.cause, 72);
  for (const line of causeLines) {
    console.log(causeColor('  ' + line));
  }

  // 5. Empty line
  console.log('');

  // 6. Fix
  console.log(dim('  fix'));
  const fixLines = wrap(result.fix, 68);
  for (const line of fixLines) {
    console.log(fixBorder('  ▌ ') + fixColor(line));
  }

  // 7. Evidence
  if (result.evidence.length > 0) {
    console.log('');
    console.log(dim('  evidence'));
    for (const e of result.evidence.slice(0, 2)) {
      console.log(footerDim('  ›  ') + dim(e.slice(0, 80)));
    }
  }

  // 8. Alternative
  if (result.alternative) {
    console.log('');
    console.log(footerDim('  alt · ') + dim(result.alternative));
  }

  // 9. Missing (only if confidence < 60)
  if (result.missing && result.confidence < 60) {
    console.log('');
    console.log(footerDim('  needs · ') + dim(result.missing));
  }

  // 10. Empty line
  console.log('');

  // 11. Footer
  const parts: string[] = ['drill'];
  if (meta?.provider) parts.push(meta.provider);
  if (meta?.model) parts.push(meta.model);
  if (meta?.elapsedMs) parts.push(Math.round(meta.elapsedMs / 1000) + 's');
  const left = footerDim(parts.join(' · '));

  let right = '';
  if (meta?.runsWeek && meta?.weekLimit && meta.weekLimit < 999999) {
    right = footerDim(`${meta.runsWeek} / ${meta.weekLimit} this week`);
  }

  const cols = process.stdout.columns ?? 80;
  const pad = Math.max(1, cols - left.length - right.length - 4);
  console.log('  ' + left + ' '.repeat(pad) + right);

  // 12. Empty line
  console.log('');
}

export function showError(error: DrillError): void {
  const dim = chalk.hex('#484F58');
  const causeColor = chalk.hex('#E6EDF3').bold;
  const red = chalk.hex('#EF5350');

  const details: Record<DrillError['code'], { title: string; detail: string }> = {
    INVALID_KEY: { title: 'Invalid API key', detail: 'Set the correct key and run drill setup' },
    LIMIT_REACHED: { title: 'Weekly limit reached', detail: error.upgrade_url ?? '' },
    PARSE_FAILED: { title: 'Analysis failed', detail: 'The model returned an unexpected response. Try again.' },
    TIMEOUT: { title: 'Request timed out', detail: 'Use --timeout 120 to allow more time' },
    NETWORK: { title: 'Network error', detail: error.message },
    REDACTED_EMPTY: { title: 'Input fully redacted', detail: 'Use --no-redact if the log contains no sensitive data' },
    EMPTY_INPUT: { title: 'No input', detail: 'Usage: cat error.log | drill' },
    CHUNK_FAILED: { title: 'Chunking failed', detail: error.message },
    API_ERROR: { title: 'API error', detail: error.message },
    SERVER_ERROR: { title: 'Server error', detail: error.message },
    NO_KEY: { title: 'No API key', detail: 'Run drill setup or set DRILL_API_KEY' },
    PROVIDER_ERROR: { title: 'Provider error', detail: error.message },
  };

  const { title, detail } = details[error.code] ?? { title: error.code, detail: error.message };

  console.log('');
  console.log(red('  ✕ ') + causeColor(title));
  if (detail) {
    console.log(dim('    ' + detail));
  }
  console.log('');
}

export function showInputInfo(
  lines: number,
  deduped: number,
  signalLines: number,
  wasChunked: boolean,
): void {
  const dim = chalk.hex('#484F58');
  if (wasChunked) {
    console.log(dim(
      `  ${lines.toLocaleString()} lines · deduped to ${deduped} · ${signalLines} signal lines · truncated to fit context`
    ));
  } else {
    console.log(dim(
      `  ${lines.toLocaleString()} lines · deduped to ${deduped} · ${signalLines} signal lines extracted`
    ));
  }
}

export function showRedactStats(stats: import('../types.js').RedactStats): void {
  if (stats.totalReplacements === 0) return;
  console.log(chalk.dim(`  Redacted: ${stats.totalReplacements} pattern${stats.totalReplacements === 1 ? '' : 's'} (${stats.charsRemoved} chars)`));
}
