import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { readGitDiff, formatGitDiffBlock } from '../src/lib/gitdiff';

describe('readGitDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available=false when not in a git repo', () => {
    vi.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('not a repo');
    });
    const result = readGitDiff();
    expect(result.available).toBe(false);
    expect(result.error).toContain('git repository');
  });

  it('returns diff content when in a valid repo', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('.git'))
      .mockReturnValueOnce(Buffer.from('abc1234'))
      .mockReturnValueOnce(Buffer.from('fix: payment bug'))
      .mockReturnValueOnce(Buffer.from('UserService.java\nPaymentController.java'))
      .mockReturnValueOnce(Buffer.from('-const x = null;\n+const x = client.init();'));

    const result = readGitDiff();
    expect(result.available).toBe(true);
    expect(result.commitHash).toBe('abc1234');
    expect(result.commitMessage).toBe('fix: payment bug');
    expect(result.changedFiles).toEqual(['UserService.java', 'PaymentController.java']);
    expect(result.diff).toContain('client.init()');
  });

  it('truncates very large diffs', () => {
    const hugeDiff = 'x'.repeat(20_000);
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('.git'))
      .mockReturnValueOnce(Buffer.from('abc1234'))
      .mockReturnValueOnce(Buffer.from('big commit'))
      .mockReturnValueOnce(Buffer.from('file.ts'))
      .mockReturnValueOnce(Buffer.from(hugeDiff));

    const result = readGitDiff();
    expect(result.diff.length).toBeLessThanOrEqual(8_100);
    expect(result.diff).toContain('truncated');
  });

  it('never throws on any error', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git exploded');
    });
    expect(() => readGitDiff()).not.toThrow();
  });

  it('falls back to staged changes on first commit', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce(Buffer.from('.git'))
      .mockReturnValueOnce(Buffer.from('abc1234'))
      .mockReturnValueOnce(Buffer.from('init commit'))
      .mockReturnValueOnce(Buffer.from('file1.ts'))
      .mockReturnValueOnce(Buffer.from('+const x = 1;'))
      .mockImplementationOnce(() => {
        throw new Error('HEAD~1: bad revision');
      })
      .mockReturnValueOnce(Buffer.from('.git'))
      .mockReturnValueOnce(Buffer.from('abc1234'))
      .mockReturnValueOnce(Buffer.from('+const x = 1;'));

    const result = readGitDiff();
    expect(result.available).toBe(true);
  });
});

describe('formatGitDiffBlock', () => {
  it('returns empty string when not available', () => {
    expect(formatGitDiffBlock({
      available: false, diff: '', changedFiles: [],
      commitHash: '', commitMessage: '',
    })).toBe('');
  });

  it('returns empty string when diff is empty', () => {
    expect(formatGitDiffBlock({
      available: true, diff: '', changedFiles: [],
      commitHash: 'abc123', commitMessage: 'fix',
    })).toBe('');
  });

  it('includes commit hash and message', () => {
    const block = formatGitDiffBlock({
      available: true,
      diff: '-old\n+new',
      changedFiles: ['file.ts'],
      commitHash: 'abc1234',
      commitMessage: 'fix bug',
    });
    expect(block).toContain('abc1234');
    expect(block).toContain('fix bug');
    expect(block).toContain('file.ts');
    expect(block).toContain('-old');
    expect(block).toContain('+new');
    expect(block).toContain('=== GIT CONTEXT ===');
    expect(block).toContain('=== END GIT CONTEXT ===');
  });

  it('omits changed files when empty', () => {
    const block = formatGitDiffBlock({
      available: true,
      diff: '-old\n+new',
      changedFiles: [],
      commitHash: 'abc1234',
      commitMessage: 'fix bug',
    });
    expect(block).not.toContain('Changed files:');
  });

  it('handles no staged changes message', () => {
    const block = formatGitDiffBlock({
      available: true,
      diff: '(no staged changes)',
      changedFiles: [],
      commitHash: 'abc1234',
      commitMessage: 'init',
    });
    expect(block).toContain('(no staged changes)');
  });
});
