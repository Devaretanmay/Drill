import { describe, it, expect } from 'vitest';
import { chunk, estimateTokens, findErrorLines } from '../src/lib/chunk';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for non-string input', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBeCloseTo(100, 0);
  });

  it('handles unicode characters', () => {
    expect(estimateTokens('你好世界')).toBe(1);
  });
});

describe('findErrorLines', () => {
  it('finds ERROR keyword lines', () => {
    const lines = ['info: started', 'ERROR: connection refused', 'info: retrying'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('finds Exception in NullPointerException lines', () => {
    const lines = ['at', 'NullPointerException: null', 'at UserService'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('finds multiple error lines', () => {
    const lines = ['ERROR: first', 'ok', 'FATAL: second', 'ok'];
    expect(findErrorLines(lines)).toEqual([0, 2]);
  });

  it('finds CRITICAL keyword lines', () => {
    const lines = ['INFO: all good', 'CRITICAL: system failure', 'INFO: retry'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('finds Traceback keyword lines', () => {
    const lines = ['def foo():', 'Traceback (most recent call last):', '  print(x)'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('finds SEVERE keyword lines', () => {
    const lines = ['SEVERE: Database connection failed'];
    expect(findErrorLines(lines)).toEqual([0]);
  });

  it('finds panic: keyword lines', () => {
    const lines = ['normal operation', 'panic: runtime error: index out of range'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('finds OOM keyword lines', () => {
    const lines = ['Killed', 'INFO: restarting'];
    expect(findErrorLines(lines)).toEqual([0]);
  });

  it('finds segfault keyword lines', () => {
    const lines = ['Application crashed', 'segfault'];
    expect(findErrorLines(lines)).toEqual([1]);
  });

  it('is case insensitive', () => {
    const lines = ['error: test', 'Error: TEST', 'ERROR: test'];
    expect(findErrorLines(lines)).toEqual([0, 1, 2]);
  });

  it('returns empty array for clean logs', () => {
    expect(findErrorLines(['info: all good', 'debug: processing'])).toEqual([]);
  });

  it('handles empty array', () => {
    expect(findErrorLines([])).toEqual([]);
  });

  it('handles non-array input', () => {
    expect(findErrorLines(null as unknown as string[])).toEqual([]);
    expect(findErrorLines(undefined as unknown as string[])).toEqual([]);
  });
});

describe('chunk', () => {
  describe('passthrough mode', () => {
    it('returns input unchanged if under maxChars', () => {
      const input = 'short log\nno issues';
      const result = chunk(input);
      expect(result.content).toBe(input);
      expect(result.wasChunked).toBe(false);
      expect(result.strategy).toBe('passthrough');
    });

    it('reports correct originalLines count', () => {
      const input = 'a\nb\nc\nd\ne';
      const result = chunk(input);
      expect(result.originalLines).toBe(5);
    });
  });

  describe('head preservation', () => {
    it('always keeps head lines', () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
      const input = lines.join('\n');
      const result = chunk(input, { maxChars: 100, headLines: 5, lastNLines: 5 });
      expect(result.content).toContain('line 0');
      expect(result.content).toContain('line 4');
    });
  });

  describe('tail preservation', () => {
    it('always keeps last N lines', () => {
      const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
      const input = lines.join('\n');
      const result = chunk(input, { maxChars: 500, lastNLines: 10 });
      expect(result.content).toContain('line 499');
      expect(result.content).toContain('line 490');
    });
  });

  describe('truncation markers', () => {
    it('includes truncation marker when chunking', () => {
      const bigLog = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n');
      const result = chunk(bigLog, { maxChars: 1000 });
      expect(result.content).toContain('[truncated]');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const result = chunk('');
      expect(result.content).toBe('');
      expect(result.wasChunked).toBe(false);
      expect(result.strategy).toBe('passthrough');
    });

    it('handles single line input', () => {
      const result = chunk('just one line');
      expect(result.content).toBe('just one line');
      expect(result.wasChunked).toBe(false);
    });

    it('handles non-string input', () => {
      const result = chunk(null as unknown as string);
      expect(result.content).toBe('');
      expect(result.wasChunked).toBe(false);
    });

    it('never exceeds maxChars significantly', () => {
      const bigLog = Array.from({ length: 10000 }, (_, i) => `line ${i}`).join('\n');
      const result = chunk(bigLog, { maxChars: 1000 });
      expect(result.content.length).toBeLessThanOrEqual(1000 + 200);
    });

    it('reports correct resultLines count', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`);
      const input = lines.join('\n');
      const result = chunk(input, { maxChars: 500 });
      expect(result.resultLines).toBeGreaterThan(0);
    });
  });

  describe('strategy selection', () => {
    it('uses passthrough when under limit', () => {
      const result = chunk('small log');
      expect(result.strategy).toBe('passthrough');
    });

    it('uses tail strategy when over budget', () => {
      const lines = Array.from({ length: 500 }, (_, i) => `info line ${i}`);
      const input = lines.join('\n');
      const result = chunk(input, { maxChars: 100, headLines: 5, lastNLines: 5 });
      expect(result.strategy).toBe('tail');
    });
  });
});
