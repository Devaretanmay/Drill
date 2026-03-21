/**
 * Signal Filter Module
 *
 * Extracts high-signal lines from a deduplicated log string.
 * Anchors on error/exception keywords and expands by context window.
 * Removes obvious health-check noise outside selected windows.
 * Falls back to full input when no signal lines match.
 */

import type { FilterOptions, FilterResult } from '../types.js';

const DEFAULT_OPTIONS: FilterOptions = {
  contextBefore: 3,
  contextAfter: 3,
};

const SIGNAL_PATTERN = /\b(ERROR|FATAL|WARN|Warning|Exception|Traceback|panic\b|CRITICAL|SEVERE|Killed|OOM|segfault|assert|assertion failed|stderr:)\b/i;

const HEALTHCHECK_PATTERN = /^\S+ "(GET|HEAD) \/(health|healthz|ping|ready|readyz|live|livez|metrics)(\/[^\s]*)? HTTP\/\S+" 2\d\d /i;

export function filter(
  input: string,
  options?: Partial<FilterOptions>,
): FilterResult {
  const opts: FilterOptions = { ...DEFAULT_OPTIONS, ...options };

  if (!input.trim()) {
    return {
      content: input,
      matchedLineCount: 0,
      keptLineCount: 0,
      removedHealthcheckLineCount: 0,
      usedFallback: false,
    };
  }

  const lines = input.split('\n');
  const n = lines.length;

  const anchors: number[] = [];
  for (let i = 0; i < n; i++) {
    if (SIGNAL_PATTERN.test(lines[i] ?? '')) {
      anchors.push(i);
    }
  }

  if (anchors.length === 0) {
    return {
      content: input,
      matchedLineCount: 0,
      keptLineCount: lines.length,
      removedHealthcheckLineCount: 0,
      usedFallback: true,
    };
  }

  const selected = new Set<number>();
  for (const anchor of anchors) {
    const start = Math.max(0, anchor - opts.contextBefore);
    const end   = Math.min(n - 1, anchor + opts.contextAfter);
    for (let i = start; i <= end; i++) {
      selected.add(i);
    }
  }

  let removedHealthcheckLineCount = 0;
  const output: string[] = [];

  for (let i = 0; i < n; i++) {
    const line = lines[i] ?? '';
    if (selected.has(i)) {
      output.push(line);
    } else {
      if (HEALTHCHECK_PATTERN.test(line)) {
        removedHealthcheckLineCount++;
      } else {
        output.push(line);
      }
    }
  }

  return {
    content: output.join('\n'),
    matchedLineCount: anchors.length,
    keptLineCount: output.length,
    removedHealthcheckLineCount,
    usedFallback: false,
  };
}
