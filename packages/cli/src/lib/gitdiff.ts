import { execSync } from 'node:child_process';

export interface GitDiffResult {
  available: boolean;
  diff: string;
  changedFiles: string[];
  commitHash: string;
  commitMessage: string;
  error?: string;
}

export function readGitDiff(cwd?: string): GitDiffResult {
  const opts = { cwd: cwd ?? process.cwd(), timeout: 10_000 };

  try {
    execSync('git rev-parse --git-dir', { ...opts, stdio: 'pipe' });
  } catch {
    return {
      available: false,
      diff: '',
      changedFiles: [],
      commitHash: '',
      commitMessage: '',
      error: 'Not a git repository',
    };
  }

  try {
    const commitHash = execSync('git rev-parse --short HEAD', {
      ...opts, stdio: 'pipe',
    }).toString().trim();

    const commitMessage = execSync('git log -1 --pretty=%s', {
      ...opts, stdio: 'pipe',
    }).toString().trim();

    const statOutput = execSync(
      'git diff HEAD~1 --name-only 2>/dev/null || git diff --cached --name-only',
      { ...opts, stdio: 'pipe' },
    ).toString().trim();

    const changedFiles = statOutput
      ? statOutput.split('\n').filter(Boolean)
      : [];

    let diff = execSync(
      'git diff HEAD~1 2>/dev/null || git diff --cached',
      { ...opts, stdio: 'pipe' },
    ).toString();

    const MAX_DIFF_CHARS = 8_000;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.slice(0, MAX_DIFF_CHARS) +
        `\n... [diff truncated — ${changedFiles.length} files changed total]`;
    }

    return {
      available: true,
      diff,
      changedFiles,
      commitHash,
      commitMessage,
    };
  } catch (e: unknown) {
    try {
      const diff = execSync('git diff --cached', {
        ...opts, stdio: 'pipe',
      }).toString().slice(0, 8_000);

      const commitHash = execSync('git rev-parse --short HEAD', {
        ...opts, stdio: 'pipe',
      }).toString().trim();

      return {
        available: true,
        diff: diff || '(no staged changes)',
        changedFiles: [],
        commitHash,
        commitMessage: '(first commit)',
      };
    } catch {
      return {
        available: false,
        diff: '',
        changedFiles: [],
        commitHash: '',
        commitMessage: '',
        error: e instanceof Error ? e.message : 'Failed to read git diff',
      };
    }
  }
}

export function formatGitDiffBlock(result: GitDiffResult): string {
  if (!result.available || !result.diff.trim()) return '';

  const lines: string[] = [
    '=== GIT CONTEXT ===',
    `Commit: ${result.commitHash} — ${result.commitMessage}`,
  ];

  if (result.changedFiles.length > 0) {
    lines.push(`Changed files: ${result.changedFiles.join(', ')}`);
  }

  if (result.diff) {
    lines.push('', 'Diff:', result.diff);
  }

  lines.push('=== END GIT CONTEXT ===');
  return lines.join('\n');
}
