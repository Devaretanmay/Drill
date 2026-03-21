import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveAuth, clearAuth, getApiKey, hasStoredAuth, getApiUrl, maskKey } from '../src/lib/auth';
import Conf from 'conf';

vi.mock('conf');

describe('auth', () => {
  const mockStore = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };

  beforeEach(() => {
    vi.mocked(Conf).mockImplementation(() => mockStore as unknown as Conf<object>);
    vi.clearAllMocks();
    process.env['DRILL_API_KEY'] = '';
    delete process.env['DRILL_API_KEY'];
    delete process.env['DRILL_API_URL'];
    delete process.env['DRILL_CONFIG_DIR'];
  });

  afterEach(() => {
    delete process.env['DRILL_API_KEY'];
    delete process.env['DRILL_API_URL'];
  });

  describe('getApiKey', () => {
    it('returns apiKey from config file', () => {
      mockStore.get.mockReturnValueOnce({ apiKey: 'config-key', apiUrl: 'https://api.drill.dev', plan: 'pro', runCount: 5, runLimit: 100 });
      
      const key = getApiKey();
      expect(key).toBe('config-key');
    });

    it('falls back to DRILL_API_KEY env var when no config key', () => {
      mockStore.get.mockReturnValueOnce({ apiKey: '', apiUrl: 'https://api.drill.dev', plan: 'free', runCount: 0, runLimit: 20 });
      process.env['DRILL_API_KEY'] = 'env-key';
      
      const key = getApiKey();
      expect(key).toBe('env-key');
    });

    it('returns empty string when no key anywhere', () => {
      mockStore.get.mockReturnValueOnce(null);
      
      const key = getApiKey();
      expect(key).toBe('');
    });
  });

  describe('hasStoredAuth', () => {
    it('returns true when apiKey is stored', () => {
      mockStore.get.mockReturnValueOnce({ apiKey: 'some-key', apiUrl: 'https://api.drill.dev', plan: 'free', runCount: 0, runLimit: 20 });
      
      expect(hasStoredAuth()).toBe(true);
    });

    it('returns false when no auth data', () => {
      mockStore.get.mockReturnValueOnce(null);
      
      expect(hasStoredAuth()).toBe(false);
    });

    it('returns false when apiKey is empty string', () => {
      mockStore.get.mockReturnValueOnce({ apiKey: '', apiUrl: 'https://api.drill.dev', plan: 'free', runCount: 0, runLimit: 20 });
      
      expect(hasStoredAuth()).toBe(false);
    });
  });

  describe('getApiUrl', () => {
    it('returns apiUrl from config', () => {
      mockStore.get.mockReturnValueOnce({ apiKey: 'key', apiUrl: 'https://custom.api', plan: 'pro', runCount: 5, runLimit: 100 });
      
      const url = getApiUrl();
      expect(url).toBe('https://custom.api');
    });

    it('returns DRILL_API_URL env var when no config', () => {
      mockStore.get.mockReturnValueOnce(null);
      process.env['DRILL_API_URL'] = 'https://env.api';
      
      const url = getApiUrl();
      expect(url).toBe('https://env.api');
    });

    it('returns default when nothing set', () => {
      mockStore.get.mockReturnValueOnce(null);
      delete process.env['DRILL_API_URL'];
      
      const url = getApiUrl();
      expect(url).toBe('https://api.drill.dev');
    });
  });

  describe('maskKey', () => {
    it('masks long keys', () => {
      expect(maskKey('abcdefghijklmnop')).toBe('abcd***mnop');
    });

    it('returns *** for keys 8 chars or fewer', () => {
      expect(maskKey('short')).toBe('***');
      expect(maskKey('12345678')).toBe('***');
    });

    it('masks keys longer than 8 chars', () => {
      expect(maskKey('123456789012')).toBe('1234***9012');
      expect(maskKey('abcdefghijklmnop')).toBe('abcd***mnop');
    });
  });

  describe('saveAuth', () => {
    it('saves auth data to config', () => {
      const data = {
        email: 'test@example.com',
        registered: true,
        plan: 'free',
        weekLimit: 100,
      };

      saveAuth(data);

      expect(mockStore.set).toHaveBeenCalledWith('auth', expect.objectContaining({
        email: 'test@example.com',
        registered: true,
        plan: 'free',
        weekLimit: 100,
      }));
    });
  });

  describe('clearAuth', () => {
    it('deletes auth from config', () => {
      clearAuth();

      expect(mockStore.delete).toHaveBeenCalledWith('auth');
    });
  });
});
