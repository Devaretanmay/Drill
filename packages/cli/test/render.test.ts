import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showThinking, showResult, showError, showInputInfo, showRedactStats,
} from '../src/lib/render';
import type { DrillResult, DrillError } from '../src/types';

const mockResult: DrillResult = {
  cause: 'Database connection pool exhausted due to high concurrent load',
  confidence: 87,
  severity: 'high',
  evidence: ['ERROR: remaining connection slots are reserved at 14:07:33'],
  fix: 'Increase DB_POOL_SIZE from 10 to 25 in your .env file',
  alternative: 'Memory pressure causing connection drops',
  missing: null,
};

describe('render', () => {
  describe('showResult', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('outputs content including cause', () => {
      showResult(mockResult);
      const output = consoleOutput.join('\n');
      expect(output).toContain('Database connection pool');
    });

    it('outputs confidence percentage', () => {
      showResult(mockResult);
      const output = consoleOutput.join('\n');
      expect(output).toContain('87%');
    });

    it('outputs fix text', () => {
      showResult(mockResult);
      const output = consoleOutput.join('\n');
      expect(output).toContain('DB_POOL_SIZE');
    });

    it('outputs evidence lines', () => {
      showResult(mockResult);
      const output = consoleOutput.join('\n');
      expect(output).toContain('remaining connection slots');
    });

    it('outputs alternative when present', () => {
      showResult(mockResult);
      const output = consoleOutput.join('\n');
      expect(output).toContain('Memory pressure');
    });

    it('does not show alternative when null', () => {
      showResult({ ...mockResult, alternative: null });
      const output = consoleOutput.join('\n');
      expect(output).not.toContain('Alternative:');
    });

    it('shows remaining count when provided', () => {
      showResult(mockResult, 3);
      const output = consoleOutput.join('\n');
      expect(output).toContain('3 run');
    });

    it('shows severity labels', () => {
      showResult({ ...mockResult, severity: 'critical' });
      const output = consoleOutput.join('\n');
      expect(output).toContain('CRITICAL');
    });

    it('shows evidence truncated at 120 chars', () => {
      const longEvidence = 'x'.repeat(150);
      showResult({ ...mockResult, evidence: [longEvidence] });
      const output = consoleOutput.join('\n');
      expect(output).toContain('...');
      expect(output).not.toContain(longEvidence);
    });
  });

  describe('showThinking', () => {
    it('does not crash on empty text', () => {
      expect(() => showThinking('')).not.toThrow();
    });

    it('does not crash on whitespace-only text', () => {
      expect(() => showThinking('   \n  ')).not.toThrow();
    });

    it('writes thinking lines to stdout without crashing', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      showThinking('Analyzing the error...\nDatabase connection failed');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('skips empty lines in thinking output', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      showThinking('step one\n\nstep two');
      const output = spy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('step one');
      expect(output).toContain('step two');
      spy.mockRestore();
    });
  });

  describe('showError', () => {
    let stderrOutput: string[] = [];
    const originalError = console.error;

    beforeEach(() => {
      stderrOutput = [];
      console.error = (...args: unknown[]) => { stderrOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.error = originalError;
    });

    it('shows INVALID_KEY message', () => {
      showError({ code: 'INVALID_KEY', message: 'bad key' });
      expect(stderrOutput.join('\n')).toContain('Invalid API key');
    });

    it('shows LIMIT_REACHED message with upgrade URL', () => {
      showError({ code: 'LIMIT_REACHED', message: 'limit', upgrade_url: 'https://drill.dev/upgrade' });
      const output = stderrOutput.join('\n');
      expect(output).toContain('limit');
      expect(output).toContain('drill.dev/upgrade');
    });

    it('shows PARSE_FAILED message', () => {
      showError({ code: 'PARSE_FAILED', message: 'bad json' });
      expect(stderrOutput.join('\n')).toContain('parse');
    });

    it('shows REDACTED_EMPTY message with --no-redact hint', () => {
      showError({ code: 'REDACTED_EMPTY', message: 'all redacted' });
      const output = stderrOutput.join('\n');
      expect(output).toContain('redacted');
      expect(output).toContain('--no-redact');
    });

    it('shows NETWORK error', () => {
      showError({ code: 'NETWORK', message: 'Connection refused' });
      const output = stderrOutput.join('\n');
      expect(output).toContain('Network error');
    });

    it('falls back to message for unknown error codes', () => {
      showError({ code: 'SERVER_ERROR', message: 'Internal server error' });
      expect(stderrOutput.join('\n')).toContain('Internal server error');
    });

    it('shows INVALID_KEY with default message when no message provided', () => {
      showError({ code: 'INVALID_KEY', message: '' });
      const output = stderrOutput.join('\n');
      expect(output).toContain('Invalid API key');
    });
  });

  describe('showInputInfo', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('shows line count when not chunked', () => {
      showInputInfo(100, false);
      expect(consoleOutput.join('')).toContain('100');
    });

    it('shows truncated note when chunked', () => {
      showInputInfo(1000, true);
      expect(consoleOutput.join('')).toContain('truncated');
    });
  });

  describe('showRedactStats', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('shows stats when replacements were made', () => {
      showRedactStats({ patternsMatched: { email: 2 }, totalReplacements: 2, charsRemoved: 20 });
      expect(consoleOutput.join('')).toContain('2');
      expect(consoleOutput.join('')).toContain('20');
    });

    it('does nothing when no replacements', () => {
      showRedactStats({ patternsMatched: {}, totalReplacements: 0, charsRemoved: 0 });
      expect(consoleOutput).toHaveLength(0);
    });

    it('shows single replacement correctly', () => {
      showRedactStats({ patternsMatched: { ip: 1 }, totalReplacements: 1, charsRemoved: 12 });
      expect(consoleOutput.join('')).toContain('1');
      expect(consoleOutput.join('')).toContain('12');
    });
  });
});
