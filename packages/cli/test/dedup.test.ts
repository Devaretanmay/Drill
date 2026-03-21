import { describe, it, expect } from 'vitest';
import { dedup } from '../src/lib/dedup';

describe('dedup', () => {
  it('collapses consecutive identical lines', () => {
    const input = 'ERROR: ECONNREFUSED\nERROR: ECONNREFUSED\nERROR: ECONNREFUSED';
    expect(dedup(input)).toBe('ERROR: ECONNREFUSED  [×3]');
  });

  it('preserves single occurrences unchanged', () => {
    const line = 'ERROR: something unique';
    expect(dedup(line)).toBe(line);
  });

  it('does not collapse non-consecutive repeats', () => {
    const input = 'ERROR: a\nINFO: b\nERROR: a';
    expect(dedup(input)).toBe(input);
  });

  it('preserves original line order', () => {
    const input = 'line1\nline1\nline2\nline2\nline3';
    expect(dedup(input)).toBe('line1  [×2]\nline2  [×2]\nline3');
  });

  it('never collapses empty lines', () => {
    const input = 'a\n\n\nb';
    expect(dedup(input)).toBe('a\n\n\nb');
  });

  it('handles empty string input', () => {
    expect(dedup('')).toBe('');
  });

  it('handles whitespace-only input', () => {
    expect(dedup('   \n  ')).toBe('   \n  ');
  });

  it('handles already-unique input unchanged', () => {
    const input = 'a\nb\nc\nd';
    expect(dedup(input)).toBe(input);
  });

  it('handles single line input', () => {
    expect(dedup('only one line')).toBe('only one line');
  });

  it('collapses long run into single annotated line', () => {
    const line = 'WARN: retrying connection';
    const input = Array(50).fill(line).join('\n');
    expect(dedup(input)).toBe(`${line}  [×50]`);
  });
});
