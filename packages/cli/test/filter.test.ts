import { describe, it, expect } from 'vitest';
import { filter } from '../src/lib/filter';

describe('filter', () => {
  it('keeps ERROR lines', () => {
    const input = 'INFO: ok\nERROR: db fail\nINFO: ok';
    const result = filter(input);
    expect(result.content).toContain('ERROR: db fail');
    expect(result.matchedLineCount).toBe(1);
    expect(result.usedFallback).toBe(false);
  });

  it('keeps FATAL, WARN, Traceback, panic lines', () => {
    for (const keyword of ['FATAL: crash', 'WARN: slow', 'Traceback (most recent', 'panic: nil pointer']) {
      const result = filter(keyword);
      expect(result.content).toContain(keyword);
      expect(result.matchedLineCount).toBeGreaterThan(0);
    }
  });

  it('includes context lines before and after match', () => {
    const lines = [
      'INFO: starting',
      'INFO: connecting',
      'ERROR: refused',
      'INFO: retrying',
      'INFO: done',
    ];
    const result = filter(lines.join('\n'), { contextBefore: 2, contextAfter: 2 });
    expect(result.content).toContain('INFO: starting');
    expect(result.content).toContain('INFO: connecting');
    expect(result.content).toContain('ERROR: refused');
    expect(result.content).toContain('INFO: retrying');
    expect(result.content).toContain('INFO: done');
  });

  it('merges overlapping context windows', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    lines[3] = 'ERROR: first';
    lines[5] = 'ERROR: second';
    const result = filter(lines.join('\n'), { contextBefore: 2, contextAfter: 2 });
    const outputLines = result.content.split('\n');
    const unique = new Set(outputLines);
    expect(unique.size).toBe(outputLines.length);
  });

  it('removes health-check lines outside selected windows', () => {
    const input = [
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
      '172.0.0.1 "GET /ping HTTP/1.1" 200 -',
      'ERROR: database fail',
    ].join('\n');
    const result = filter(input, { contextBefore: 0, contextAfter: 0 });
    expect(result.content).not.toContain('/health');
    expect(result.content).not.toContain('/ping');
    expect(result.removedHealthcheckLineCount).toBe(2);
  });

  it('preserves health-check lines inside selected error windows', () => {
    const input = [
      'ERROR: something broke',
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
      'INFO: recovered',
    ].join('\n');
    const result = filter(input, { contextBefore: 0, contextAfter: 2 });
    expect(result.content).toContain('/health');
    expect(result.removedHealthcheckLineCount).toBe(0);
  });

  it('falls back to full input when no signal lines match', () => {
    const input = 'INFO: all good\nINFO: processing\nINFO: done';
    const result = filter(input);
    expect(result.usedFallback).toBe(true);
    expect(result.content).toBe(input);
    expect(result.matchedLineCount).toBe(0);
  });

  it('handles empty string input', () => {
    const result = filter('');
    expect(result.content).toBe('');
    expect(result.matchedLineCount).toBe(0);
  });

  it('handles all-whitespace input', () => {
    const result = filter('   \n  \n   ');
    expect(result.matchedLineCount).toBe(0);
  });

  it('preserves line order in output', () => {
    const input = 'INFO: a\nERROR: b\nINFO: c\nERROR: d\nINFO: e';
    const result = filter(input, { contextBefore: 0, contextAfter: 0 });
    const idx_b = result.content.indexOf('ERROR: b');
    const idx_d = result.content.indexOf('ERROR: d');
    expect(idx_b).toBeLessThan(idx_d);
  });
});
