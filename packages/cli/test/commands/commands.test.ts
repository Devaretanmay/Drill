import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/commands/config';
import { statusCommand } from '../../src/commands/status';
import { logoutCommand } from '../../src/commands/logout';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn().mockReturnValue(null),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  getApiKey: vi.fn().mockReturnValue(''),
  hasStoredAuth: vi.fn().mockReturnValue(false),
  getApiUrl: vi.fn().mockReturnValue('https://api.drill.dev'),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  getProvider: vi.fn().mockReturnValue('minimax'),
  getProviderModel: vi.fn().mockReturnValue('MiniMax-M2.5'),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {},
}));

vi.mock('../../src/lib/identity', () => ({
  getStatus: vi.fn().mockResolvedValue({ found: false }),
  checkAndCount: vi.fn().mockResolvedValue({ allowed: true, registered: false, runsWeek: 0, limit: 100, plan: 'free' }),
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
        provider: 'openai' as const, providerModel: 'gpt-4o',
        model: 'cloud' as const, localModel: undefined,
        redact: true, customUrl: undefined,
      });

      await configCommand({ action: 'get', key: 'plan' });

      expect(consoleOutput.join('')).toBe('pro');
    });

    it('config get runLimit — shows limit', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        apiKey: 'key', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100,
        provider: 'openai' as const, providerModel: 'gpt-4o',
        model: 'cloud' as const, localModel: undefined,
        redact: true, customUrl: undefined,
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
      vi.mocked(auth.getApiKey).mockReturnValue('');
    });

    afterEach(() => {
      console.log = originalLog;
    });

    it('shows not registered when no API key', async () => {
      vi.mocked(auth.getApiKey).mockReturnValue('');

      await statusCommand();

      const output = consoleOutput.join('');
      expect(output).toContain('Not registered');
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
