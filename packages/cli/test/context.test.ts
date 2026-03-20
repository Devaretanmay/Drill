import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('context', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('keyword extraction patterns', () => {
    it('handles empty log input without crashing', async () => {
      // The buildContext function should not throw on empty input
      // It extracts keywords from the log — with empty log, no keywords
      const { buildContext } = await import('../src/lib/context');
      // Mock the fs module to return empty directory
      vi.doMock('node:fs', () => ({
        readdirSync: vi.fn().mockReturnValue([]),
        statSync: vi.fn(),
        readFileSync: vi.fn(),
      }));
      
      const result = await buildContext('/fake', '');
      // No keywords, no files, should return empty string
      expect(result).toBe('');
    });

    it('handles log with special characters', async () => {
      const { buildContext } = await import('../src/lib/context');
      vi.doMock('node:fs', () => ({
        readdirSync: vi.fn().mockReturnValue([]),
        statSync: vi.fn(),
        readFileSync: vi.fn(),
      }));

      const result = await buildContext('/fake', 'ERROR: connection @#$%^ refused!');
      expect(typeof result).toBe('string');
    });

    it('handles very long log input', async () => {
      const { buildContext } = await import('../src/lib/context');
      vi.doMock('node:fs', () => ({
        readdirSync: vi.fn().mockReturnValue([]),
        statSync: vi.fn(),
        readFileSync: vi.fn(),
      }));

      const longLog = 'ERROR '.repeat(1000);
      const result = await buildContext('/fake', longLog);
      expect(typeof result).toBe('string');
    });
  });
});
