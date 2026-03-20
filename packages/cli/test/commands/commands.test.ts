import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/commands/config';
import { statusCommand } from '../../src/commands/status';
import { logoutCommand } from '../../src/commands/logout';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn(),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  getApiKey: vi.fn(),
  hasStoredAuth: vi.fn(),
  getApiUrl: vi.fn(),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  getProvider: vi.fn().mockReturnValue('minimax'),
  getProviderModel: vi.fn().mockReturnValue('MiniMax-M2.5'),
}));

vi.mock('../../src/lib/env', () => ({
  validateEnv: vi.fn().mockReturnValue({
    DRILL_API_URL: 'https://api.drill.dev',
    DRILL_FALLBACK_URL: 'https://api.together.xyz/v1',
    DRILL_FALLBACK_KEY: '',
    DRILL_MODEL: 'MiniMax-M2.5',
    DRILL_FALLBACK_MODEL: 'MiniMaxAI/MiniMax-M2.5',
  }),
}));

import * as auth from '../../src/lib/auth';
import * as env from '../../src/lib/env';

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
      vi.mocked(auth.getApiUrl).mockReturnValue('https://api.drill.dev');
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);

      await configCommand({ action: 'list' });

      expect(consoleOutput.join('')).toContain('Configuration');
    });

    it('config get plan — shows plan', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'key', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100,
      });

      await configCommand({ action: 'get', key: 'plan' });

      expect(consoleOutput.join('')).toBe('pro');
    });

    it('config get runLimit — shows limit', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'key', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100,
      });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'get', key: 'runLimit' });
      expect(consoleOutput.join('')).toBe('100');
      exitSpy.mockRestore();
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

    it('config set plan — rejects with clear message', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await configCommand({ action: 'set', key: 'plan', value: 'pro' });
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorOutput.join('')).toContain('read-only');
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

  describe('statusCommand', () => {
    let consoleOutput: string[] = [];
    const originalLog = console.log;

    beforeEach(() => {
      consoleOutput = [];
      console.log = (...args: unknown[]) => { consoleOutput.push(args.join(' ')); };
    });

    afterEach(() => {
      console.log = originalLog;
      delete process.env['DRILL_API_KEY'];
    });

    it('shows status with no API key', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);

      await statusCommand();

      expect(consoleOutput.join('')).toContain('Drill Status');
      expect(consoleOutput.join('')).toContain('No API key');
    });

    it('shows status with stored auth', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'test-key-123456', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100,
        provider: 'openai', providerModel: 'gpt-4o', model: 'cloud', localModel: undefined,
        redact: true, customUrl: undefined,
      });
      vi.mocked(auth.hasStoredAuth).mockReturnValue(true);
      vi.mocked(auth.getProvider).mockReturnValue('openai');
      vi.mocked(auth.getProviderModel).mockReturnValue('gpt-4o');

      await statusCommand();

      const output = consoleOutput.join('');
      expect(output).toContain('Drill Status');
      expect(output).toContain('pro');
    });

    it('shows status with env var key', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);
      vi.mocked(auth.getProvider).mockReturnValue('minimax');
      vi.mocked(auth.getProviderModel).mockReturnValue('MiniMax-M2.5');
      process.env['DRILL_API_KEY'] = 'env-key-123';

      await statusCommand();

      const output = consoleOutput.join('');
      expect(output).toContain('Drill Status');
      expect(output).toContain('minimax');
    });

    it('shows remaining runs warning when low', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'key', apiUrl: 'https://api.drill.dev', plan: 'free', runCount: 18, runLimit: 20,
        provider: 'minimax', providerModel: 'MiniMax-M2.5', model: 'cloud', localModel: undefined,
        redact: true, customUrl: undefined,
      });
      vi.mocked(auth.hasStoredAuth).mockReturnValue(true);

      await statusCommand();

      expect(consoleOutput.join('')).toContain('remaining');
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

    it('clears auth and confirms when logged in', async () => {
      vi.mocked(auth.hasStoredAuth).mockReturnValue(true);

      await logoutCommand();

      expect(vi.mocked(auth.clearAuth)).toHaveBeenCalledOnce();
      expect(consoleOutput.join('')).toContain('Logged out');
    });

    it('shows message when not logged in', async () => {
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);

      await logoutCommand();

      expect(vi.mocked(auth.clearAuth)).toHaveBeenCalledOnce();
      expect(consoleOutput.join('')).toContain('No stored authentication');
    });
  });
});
