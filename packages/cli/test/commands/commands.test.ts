import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configCommand } from '../../src/commands/config';
import { statusCommand } from '../../src/commands/status';
import { logoutCommand } from '../../src/commands/logout';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn().mockReturnValue({ supabaseToken: null }),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  clearSessionAuth: vi.fn(),
  getApiKey: vi.fn(),
  hasStoredAuth: vi.fn(),
  getApiUrl: vi.fn(),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  getProvider: vi.fn().mockReturnValue('minimax'),
  getProviderModel: vi.fn().mockReturnValue('MiniMax-M2.5'),
  isAuthenticated: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/lib/supabase', () => ({
  supabase: {},
  authedClient: vi.fn().mockReturnValue({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    }),
  }),
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
    });

    afterEach(() => {
      console.log = originalLog;
      vi.unstubAllEnvs();
    });

    it('shows not logged in when no auth', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);
      vi.mocked(auth.isAuthenticated).mockReturnValue(false);

      await statusCommand();

      const output = consoleOutput.join('');
      expect(output).toContain('Not logged in');
    });

    it('shows status when logged in', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        supabaseToken: 'test-token',
        supabaseUserId: 'test-user-id',
        email: 'test@example.com',
        apiKey: 'key', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100,
        provider: 'openai', providerModel: 'gpt-4o', model: 'cloud', localModel: undefined,
        redact: true, customUrl: undefined,
        runsWeek: 10, weekLimit: 100, weekReset: '2029-01-01',
      });
      vi.mocked(auth.isAuthenticated).mockReturnValue(true);

      await statusCommand();

      const output = consoleOutput.join('');
      expect(output).toContain('Drill status');
      expect(output).toContain('test@example.com');
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

    it('clears auth when logged in', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        supabaseToken: 'test-token',
        supabaseUserId: 'test-user-id',
        apiKey: 'test',
        apiUrl: 'https://api.drill.dev',
        plan: 'free',
        runCount: 0,
        runLimit: 100,
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        model: 'cloud' as const,
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      await logoutCommand();

      expect(vi.mocked(auth.clearSessionAuth)).toHaveBeenCalledOnce();
    });

    it('does not clear session state when not logged in', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);

      await logoutCommand();

      expect(vi.mocked(auth.clearSessionAuth)).not.toHaveBeenCalled();
    });
  });
});
