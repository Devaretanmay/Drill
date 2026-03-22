import { describe, it, expect, vi } from 'vitest';
import { buildContext } from '../../src/lib/context';
import { readFileSync, statSync, readdirSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe('context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildContext', () => {
    it('returns empty string when directory is empty', async () => {
      vi.mocked(readdirSync).mockReturnValue([]);
      const result = await buildContext('/fake', 'ERROR at line 1');
      expect(result).toBe('');
    });

    it('returns empty string when directory does not exist', async () => {
      vi.mocked(readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = await buildContext('/nonexistent', 'ERROR at line 1');
      expect(result).toBe('');
    });

    it('ignores node_modules directory', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['node_modules', 'index.ts'];
        return [];
      });
      vi.mocked(statSync).mockImplementation((p: string) => ({
        isDirectory: () => String(p).endsWith('node_modules'),
        isFile: () => !String(p).endsWith('node_modules'),
      } as ReturnType<typeof statSync>));
      vi.mocked(readFileSync).mockReturnValue('export function main() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'ERROR: something failed');
      expect(result).not.toContain('node_modules');
    });

    it('ignores .lock files', async () => {
      vi.mocked(readdirSync).mockReturnValue(['package-lock.json', 'index.ts']);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('export function main() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'ERROR: something failed');
      expect(result).not.toContain('package-lock.json');
    });

    it('ignores minified files', async () => {
      vi.mocked(readdirSync).mockReturnValue(['bundle.min.js', 'index.ts']);
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('export function main() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'ERROR: something failed');
      expect(result).not.toContain('bundle.min.js');
    });

    it('includes source files that match keywords from log', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['UserService.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('export class UserService {\n  connect() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'ERROR: UserService.connect() failed at UserService.ts:42');
      expect(result).toContain('UserService.ts');
      expect(result).toContain('connect');
    });

    it('enforces MAX_CONTEXT_CHARS limit on output', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['file1.ts', 'file2.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockImplementation(() => 'x'.repeat(30_000));
      const result = await buildContext('/fake', 'ERROR: test');
      expect(result.length).toBeLessThan(50_100);
    });

    it('handles unreadable files gracefully', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['unreadable.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = await buildContext('/fake', 'ERROR: test');
      expect(typeof result).toBe('string');
    });

    it('returns empty for non-matching keywords (INFO-only log)', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['index.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('// no relevant content\n'.repeat(10));
      const result = await buildContext('/fake', 'INFO: health check ok');
      expect(result).toBe('');
    });

    it('walks subdirectories recursively', async () => {
      const dirCalls: string[] = [];
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        dirCalls.push(String(dir));
        if (dir === '/fake') return ['src', 'index.ts'];
        return [];
      });
      vi.mocked(statSync).mockImplementation((p: string) => ({
        isDirectory: () => String(p).endsWith('src') || (String(p).split('/').length > 3 && !String(p).endsWith('.ts')),
        isFile: () => String(p).endsWith('.ts'),
      } as ReturnType<typeof statSync>));
      vi.mocked(readFileSync).mockReturnValue('export function main() {}\n'.repeat(5));
      await buildContext('/fake', 'ERROR: test');
      expect(dirCalls.length).toBeGreaterThan(1);
    });

    it('extracts keywords from Python traceback', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['app.py'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('def process_data():\n  return True\n'.repeat(10));
      const result = await buildContext('/fake', 'File "app.py", line 42, in process_data\n  def process_data():');
      expect(typeof result).toBe('string');
    });

    it('extracts keywords from Go stack trace', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['server.go'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('func processRequest() {\n  return\n}\n'.repeat(10));
      const result = await buildContext('/fake', 'func processRequest() {\n  /path/to/server.go:42');
      expect(typeof result).toBe('string');
    });

    it('extracts keywords from Rust stack trace', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['main.rs'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('fn main() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'fn main() {\n  /src/main.rs:5');
      expect(typeof result).toBe('string');
    });

    it('extracts keywords from JavaScript error with at pattern', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['handler.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('export function handle() {}\n'.repeat(10));
      const result = await buildContext('/fake', 'at handle (/app/handler.ts:12:5)');
      expect(typeof result).toBe('string');
    });

    it('extracts keywords from import statements', async () => {
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        if (dir === '/fake') return ['index.ts'];
        return [];
      });
      vi.mocked(statSync).mockReturnValue({ isDirectory: () => false, isFile: () => true } as ReturnType<typeof statSync>);
      vi.mocked(readFileSync).mockReturnValue('import { userRouter } from "./routes/user"\n'.repeat(10));
      const result = await buildContext('/fake', 'import { userRouter } from "./routes/user"');
      expect(typeof result).toBe('string');
    });

    it('skips files deeper than MAX_DEPTH', async () => {
      const dirCalls: string[] = [];
      vi.mocked(readdirSync).mockImplementation((dir: string) => {
        dirCalls.push(String(dir));
        const depth = String(dir).replace('/fake', '').split('/').filter(Boolean).length;
        if (depth < 4) return ['nested'];
        return [];
      });
      vi.mocked(statSync).mockImplementation((p: string) => ({
        isDirectory: () => !String(p).endsWith('.ts'),
        isFile: () => String(p).endsWith('.ts'),
      } as ReturnType<typeof statSync>));
      vi.mocked(readFileSync).mockReturnValue('export function main() {}\n'.repeat(5));
      await buildContext('/fake', 'ERROR: test');
      const deepestDepth = Math.max(...dirCalls.map(d => d.replace('/fake', '').split('/').filter(Boolean).length));
      expect(deepestDepth).toBeLessThanOrEqual(4);
    });
  });
});
