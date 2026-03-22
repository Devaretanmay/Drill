import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadAuth, saveAuth, updateAuth, clearAuth, getApiKey, hasStoredAuth, getApiUrl, getProvider, getProviderModel, maskKey } from '../src/lib/auth';
import Conf from 'conf';

vi.mock('conf');

const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mocked(Conf).mockImplementation(() => mockStore as unknown as Conf<object>);

describe('auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadAuth', () => {
    it('returns null when no config stored', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      expect(loadAuth()).toBeNull();
    });

    it('returns auth data when stored', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });
      const result = loadAuth();
      expect(result?.apiKey).toBe('sk-test');
      expect(result?.provider).toBe('openai');
    });

    it('defaults provider to minimax if not set', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: undefined as unknown,
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });
      const result = loadAuth();
      expect(result?.provider).toBe('minimax');
    });

    it('defaults redact to true if not set', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'openai',
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: undefined as unknown,
        customUrl: undefined,
      });
      const result = loadAuth();
      expect(result?.redact).toBe(true);
    });
  });

  describe('saveAuth', () => {
    it('persists auth data to store', () => {
      saveAuth({
        apiKey: 'sk-new',
        apiUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });
      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        apiKey: 'sk-new',
        provider: 'openai',
      }));
    });

    it('merges with existing data when partial', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-old',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      saveAuth({
        apiKey: 'sk-new',
        apiUrl: 'https://api.openai.com/v1',
      });

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        apiKey: 'sk-new',
        provider: 'minimax',
      }));
    });

    it('defaults apiUrl to minimax endpoint', () => {
      saveAuth({
        apiKey: 'sk-test',
      } as Parameters<typeof saveAuth>[0]);

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        apiUrl: 'https://api.minimax.io/v1',
      }));
    });
  });

  describe('updateAuth', () => {
    it('updates a single field', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      updateAuth({ provider: 'anthropic' });

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        provider: 'anthropic',
        apiKey: 'sk-test',
      }));
    });

    it('updates localModel', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'ollama',
        providerModel: 'llama3.2',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      updateAuth({ localModel: 'qwen2.5:latest' });

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        localModel: 'qwen2.5:latest',
      }));
    });

    it('sets customUrl to undefined when empty string passed', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'custom',
        providerModel: 'my-model',
        localModel: undefined,
        redact: true,
        customUrl: 'https://old.com/v1',
      });

      updateAuth({ customUrl: '' });

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        customUrl: undefined,
      }));
    });

    it('preserves existing fields when updating', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: false,
        customUrl: undefined,
      });

      updateAuth({ providerModel: 'gpt-4o-mini' });

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        providerModel: 'gpt-4o-mini',
        redact: false,
        provider: 'openai',
      }));
    });
  });

  describe('clearAuth', () => {
    it('deletes auth from store', () => {
      clearAuth();
      expect(mockStore.delete).toHaveBeenCalledWith('auth');
    });
  });

  describe('getApiKey', () => {
    it('returns stored apiKey when available', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-stored',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      expect(getApiKey()).toBe('sk-stored');
    });

    it('returns DRILL_API_KEY env var when no stored key', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      vi.stubEnv('DRILL_API_KEY', 'sk-from-env');

      const result = getApiKey();

      expect(result).toBe('sk-from-env');
      vi.unstubAllEnvs();
    });

    it('returns empty string when neither is set', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      vi.stubEnv('DRILL_API_KEY', '');

      expect(getApiKey()).toBe('');

      vi.unstubAllEnvs();
    });
  });

  describe('hasStoredAuth', () => {
    it('returns true when apiKey is stored', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      expect(hasStoredAuth()).toBe(true);
    });

    it('returns false when no apiKey', () => {
      vi.mocked(mockStore.get).mockReturnValue(null);
      expect(hasStoredAuth()).toBe(false);
    });

    it('returns false when apiKey is empty string', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: '',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });
      expect(hasStoredAuth()).toBe(false);
    });
  });

  describe('getApiUrl', () => {
    it('returns stored apiUrl', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.openai.com/v1',
        provider: 'openai',
        providerModel: 'gpt-4o',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      expect(getApiUrl()).toBe('https://api.openai.com/v1');
    });

    it('defaults to minimax endpoint', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      delete process.env['DRILL_API_URL'];

      expect(getApiUrl()).toBe('https://api.minimax.io/v1');
    });
  });

  describe('getProvider', () => {
    it('returns stored provider', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'anthropic',
        providerModel: 'claude-sonnet-4-20250514',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      expect(getProvider()).toBe('anthropic');
    });

    it('defaults to minimax', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      expect(getProvider()).toBe('minimax');
    });
  });

  describe('getProviderModel', () => {
    it('returns stored providerModel', () => {
      vi.mocked(mockStore.get).mockReturnValue({
        apiKey: 'sk-test',
        apiUrl: 'https://api.minimax.io/v1',
        provider: 'minimax',
        providerModel: 'MiniMax-M2.5',
        localModel: undefined,
        redact: true,
        customUrl: undefined,
      });

      expect(getProviderModel()).toBe('MiniMax-M2.5');
    });

    it('defaults to MiniMax-M2.5', () => {
      vi.mocked(mockStore.get).mockReturnValue(undefined);
      expect(getProviderModel()).toBe('MiniMax-M2.5');
    });
  });

  describe('maskKey', () => {
    it('masks keys longer than 8 chars', () => {
      expect(maskKey('sk-abc123xyz')).toBe('sk-a***3xyz');
    });

    it('returns *** for keys 8 chars or less', () => {
      expect(maskKey('shortkey')).toBe('***');
      expect(maskKey('12345678')).toBe('***');
    });
  });
});
