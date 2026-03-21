/**
 * Budget Enforcer Module
 *
 * Enforces character budget on pre-filtered log content.
 * If input is under budget, passes through unchanged.
 * If over budget, keeps head lines + truncation marker + tail lines.
 */

import type { ChunkOptions, ChunkResult } from '../types.js';

const DEFAULTS: ChunkOptions = {
  maxChars: 320000,
  lastNLines: 200,
  headLines: 20,
};

export function estimateTokens(input: string): number {
  if (typeof input !== 'string') {
    return 0;
  }
  return Math.ceil(input.length / 4);
}

export function findErrorLines(lines: string[]): number[] {
  if (!Array.isArray(lines)) {
    return [];
  }
  const ERROR_KEYWORDS = /\b(ERROR|FATAL|Traceback|panic|CRITICAL|SEVERE|stderr|Killed|OOM|segfault|core dumped|assertion failed)\b/i;
  const ERROR_SUBSTRINGS = ['Exception'];
  const errorIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line === 'string') {
      if (ERROR_KEYWORDS.test(line)) {
        errorIndices.push(i);
      } else {
        for (const substr of ERROR_SUBSTRINGS) {
          if (line.includes(substr)) {
            errorIndices.push(i);
            break;
          }
        }
      }
    }
  }
  return errorIndices;
}

export function chunk(input: string, options?: Partial<ChunkOptions>): ChunkResult {
  if (typeof input !== 'string') {
    return {
      content: '',
      wasChunked: false,
      originalLines: 0,
      resultLines: 0,
      strategy: 'passthrough',
    };
  }

  const opts: ChunkOptions = { ...DEFAULTS, ...options };
  const lines = input.split('\n');
  const originalLines = lines.length;

  if (input.length <= opts.maxChars) {
    return {
      content: input,
      wasChunked: false,
      originalLines,
      resultLines: originalLines,
      strategy: 'passthrough',
    };
  }

  const head = lines.slice(0, opts.headLines);
  const tail = lines.slice(-opts.lastNLines);
  const omitted = originalLines - opts.headLines - opts.lastNLines;
  const marker = omitted > 0 ? [`... [${omitted} lines omitted] ...`] : [];

  const result = [...head, ...marker, ...tail];
  const content = result.join('\n');

  return {
    content: content.length > opts.maxChars
      ? content.slice(0, opts.maxChars) + '\n... [truncated]'
      : content,
    wasChunked: true,
    originalLines,
    resultLines: result.length,
    strategy: 'tail',
  };
}
