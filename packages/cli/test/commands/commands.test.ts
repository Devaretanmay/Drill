import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/commands/config';
import { logoutCommand } from '../../src/commands/logout';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn().mockReturnValue(null),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  getApiKey: vi.fn().mockReturnValue(''),
  hasStoredAuth: vi.fn().mockReturnValue(false),
  getApiUrl: vi.fn().mockReturnValue('https://api.minimax.io/v1'),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  getProvider: vi.fn().mockReturnValue('minimax'),
  getProviderModel: vi.fn().mockReturnValue('MiniMax-M2.5'),
}));

vi.mock('../../src/lib/env', () => ({
  validateEnv: vi.fn().mockReturnValue({
    DRILL_API_URL: 'https://api.minimax.io/v1',
  }),
}));

import * as auth from '../../src/lib/auth';

describe('commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('configCommand', () => {
    let consoleOutput: string[] = [];
    let consoleErrorOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;

    beforeEach(() => {
      consoleOutput = [];
      consoleErrorOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
      console.error = (...args: unknown[]) => { consoleErrorOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
      console.error = originalError;
    });

    it('config list — shows configuration', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);
      vi.mocked(auth.getApiKey).mockReturnValue('');
      vi.mocked(auth.getApiUrl).mockReturnValue('https://api.minimax.io/v1');
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);

      await configCommand({ action: 'list' });

      expect(consoleOutput.join('')).toContain('Configuration');
    });

    it('config get provider — shows provider', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'key',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'openai' as const,
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      await configCommand({ action: 'get', key: 'provider' });

      expect(consoleOutput.join('')).toBe('openai');
    });

    it('config get unknown key — exits with error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'get', key: 'unknownKey' });
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorOutput.join('')).toContain('unknown config key');
      exitSpy.mockRestore();
    });

    it('config set apiKey — rejects with clear message', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'set', key: 'apiKey', value: 'secret' });
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorOutput.join('')).toContain('cannot set apiKey');
      exitSpy.mockRestore();
    });

    it('config get without key — exits with error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'get' });
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });

    it('config set without key/value — exits with error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'set' });
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    });
  });

  describe('logoutCommand', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('clears auth', async () => {
      await logoutCommand();
      expect(vi.mocked(auth.clearAuth)).toHaveBeenCalledOnce();
    });
  });
});
