import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showThinking, showResult, showError, showInputInfo, showRedactStats,
  clearThinking,
} from '../src/lib/render';
import type { DrillResult } from '../src/types';

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
      expect(output).not.toContain('alt');
    });

    it('shows severity labels', () => {
      showResult({ ...mockResult, severity: 'critical' });
      const output = consoleOutput.join('\n');
      expect(output).toContain('CRITICAL');
    });

    it('shows evidence truncated at 80 chars', () => {
      const longEvidence = 'x'.repeat(100);
      showResult({ ...mockResult, evidence: [longEvidence] });
      const output = consoleOutput.join('\n');
      expect(output).toContain('xxxx');
      expect(output).not.toContain('xxxxxxxxxx'.repeat(9));
    });

    it('shows footer with meta', () => {
      showResult(mockResult, { provider: 'openai', model: 'gpt-4o', elapsedMs: 2340 });
      const output = consoleOutput.join('\n');
      expect(output).toContain('drill');
      expect(output).toContain('openai');
      expect(output).toContain('gpt-4o');
      expect(output).toContain('2s');
    });

    it('shows missing when confidence < 60', () => {
      showResult({ ...mockResult, confidence: 50, missing: 'Need stack trace' });
      const output = consoleOutput.join('\n');
      expect(output).toContain('needs');
      expect(output).toContain('Need stack trace');
    });

    it('does not show missing when confidence >= 60', () => {
      showResult({ ...mockResult, missing: 'Need stack trace' });
      const output = consoleOutput.join('\n');
      expect(output).not.toContain('needs');
    });
  });

  describe('showThinking', () => {
    it('does not crash on empty text', () => {
      expect(() => showThinking('')).not.toThrow();
    });

    it('does not crash on whitespace-only text', () => {
      expect(() => showThinking('   \n  ')).not.toThrow();
    });

    it('writes thinking to stdout using \\r', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      showThinking('Analyzing connection pool exhaustion pattern');
      expect(spy).toHaveBeenCalled();
      const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toContain('Analyzing');
      expect(call).toContain('·');
      spy.mockRestore();
    });

    it('truncates to 60 chars', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const long = 'A'.repeat(100);
      showThinking(long);
      const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call.length).toBeLessThan(100);
      spy.mockRestore();
    });

    it('uses only first line of multiline input', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      showThinking('step one\nstep two\nstep three');
      const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toContain('step one');
      expect(call).not.toContain('step two');
      spy.mockRestore();
    });
  });

  describe('clearThinking', () => {
    it('writes spaces to clear the line', () => {
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      clearThinking();
      const call = (spy as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(call).toContain('\r');
      expect(call).toContain(' ');
      spy.mockRestore();
    });
  });

  describe('showError', () => {
    let stdoutOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      stdoutOutput = [];
      console.log = (...args: unknown[]) => { stdoutOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('shows INVALID_KEY message', () => {
      showError({ code: 'INVALID_KEY', message: 'bad key' });
      expect(stdoutOutput.join('\n')).toContain('Invalid API key');
    });

    it('shows LIMIT_REACHED message with upgrade URL', () => {
      showError({ code: 'LIMIT_REACHED', message: 'limit', upgrade_url: 'https://drill.dev/upgrade' });
      const output = stdoutOutput.join('\n');
      expect(output).toContain('Weekly limit reached');
      expect(output).toContain('drill.dev/upgrade');
    });

    it('shows LIMIT_REACHED without URL', () => {
      showError({ code: 'LIMIT_REACHED', message: 'limit' });
      const output = stdoutOutput.join('\n');
      expect(output).toContain('Weekly limit reached');
    });

    it('shows PARSE_FAILED message', () => {
      showError({ code: 'PARSE_FAILED', message: 'bad json' });
      expect(stdoutOutput.join('\n')).toContain('Analysis failed');
    });

    it('shows TIMEOUT message', () => {
      showError({ code: 'TIMEOUT', message: '' });
      const output = stdoutOutput.join('\n');
      expect(output).toContain('timed out');
    });

    it('shows REDACTED_EMPTY message', () => {
      showError({ code: 'REDACTED_EMPTY', message: 'all redacted' });
      const output = stdoutOutput.join('\n');
      expect(output).toContain('redacted');
      expect(output).toContain('--no-redact');
    });

    it('shows EMPTY_INPUT message', () => {
      showError({ code: 'EMPTY_INPUT', message: '' });
      expect(stdoutOutput.join('\n')).toContain('No input');
    });

    it('shows NETWORK error with message', () => {
      showError({ code: 'NETWORK', message: 'Connection refused' });
      const output = stdoutOutput.join('\n');
      expect(output).toContain('Network error');
      expect(output).toContain('Connection refused');
    });

    it('falls back to message for unknown error codes', () => {
      showError({ code: 'SERVER_ERROR', message: 'Internal server error' });
      expect(stdoutOutput.join('\n')).toContain('Internal server error');
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

    it('shows line count with deduped and signal lines', () => {
      showInputInfo(847, 12, 3, false);
      const output = consoleOutput.join('');
      expect(output).toContain('847');
      expect(output).toContain('deduped to 12');
      expect(output).toContain('3 signal lines');
    });

    it('shows truncated message when wasChunked is true', () => {
      showInputInfo(10000, 50, 5, true);
      const output = consoleOutput.join('');
      expect(output).toContain('truncated');
    });

    it('does not show truncated when wasChunked is false', () => {
      showInputInfo(100, 95, 0, false);
      const output = consoleOutput.join('');
      expect(output).not.toContain('truncated');
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
      const output = consoleOutput.join('');
      expect(output).toContain('1');
      expect(output).toContain('12');
    });
  });
});
