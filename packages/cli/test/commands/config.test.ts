import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configCommand } from '../../src/commands/config';
import * as auth from '../../src/lib/auth';

const mockAuthData = {
  apiKey: 'test-key',
  apiUrl: 'https://api.drill.dev',
  plan: 'free',
  runCount: 0,
  runLimit: 20,
  provider: 'openai' as const,
  providerModel: 'gpt-4o',
  model: 'cloud' as const,
  localModel: undefined as string | undefined,
  redact: true,
  customUrl: 'https://custom.com/v1' as string | undefined,
};

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn(),
  saveAuth: vi.fn(),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  hasStoredAuth: vi.fn().mockReturnValue(true),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    green: (s: string) => s,
    dim: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
    underline: (s: string) => s,
  },
}));

describe('configCommand', () => {
  beforeEach(() => {
    vi.mocked(auth.loadAuth).mockReturnValue(mockAuthData);
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('lists config with provider and model', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        ...mockAuthData,
        provider: 'openai',
        providerModel: 'gpt-4o',
      });

      await configCommand({ action: 'list' });
    });

    it('lists config with custom provider', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({
        ...mockAuthData,
        provider: 'custom',
        customUrl: 'https://my-endpoint.com/v1',
      });

      await configCommand({ action: 'list' });
    });

    it('lists config when not authenticated', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(null);
      vi.mocked(auth.hasStoredAuth).mockReturnValue(false);

      await configCommand({ action: 'list' });
    });
  });

  describe('get', () => {
    it('gets provider key', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(mockAuthData);

      await configCommand({ action: 'get', key: 'provider' });
    });

    it('gets providerModel key', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue(mockAuthData);

      await configCommand({ action: 'get', key: 'providerModel' });
    });

    it('gets customUrl key', async () => {
      vi.mocked(auth.loadAuth).mockReturnValue({ ...mockAuthData, customUrl: 'https://custom.com' });

      await configCommand({ action: 'get', key: 'customUrl' });
    });

    it('exits 1 when key is missing', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'get' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });
  });

  describe('set', () => {
    it('sets provider to valid provider', async () => {
      await configCommand({ action: 'set', key: 'provider', value: 'anthropic' });
      expect(auth.saveAuth).toHaveBeenCalled();
    });

    it('sets providerModel', async () => {
      await configCommand({ action: 'set', key: 'providerModel', value: 'claude-3' });
      expect(auth.saveAuth).toHaveBeenCalled();
    });

    it('sets customUrl', async () => {
      await configCommand({ action: 'set', key: 'customUrl', value: 'https://my-endpoint.com' });
      expect(auth.saveAuth).toHaveBeenCalled();
    });

    it('exits 1 when setting apiKey', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'set', key: 'apiKey', value: 'key' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });

    it('exits 1 when setting read-only key', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'set', key: 'plan', value: 'pro' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });

    it('exits 1 when setting invalid provider', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'set', key: 'provider', value: 'invalid' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });

    it('exits 1 when key and value are missing', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'set' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });

    it('exits 1 when setting unknown key', async () => {
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      await expect(configCommand({ action: 'set', key: 'unknown', value: 'val' })).rejects.toThrow('exit');
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
    });
  });
});
