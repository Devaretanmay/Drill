import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyze } from '../src/lib/api';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadAuth } from '../src/lib/auth';
import { getProviderApiKey } from '../src/lib/providers';

vi.mock('../src/lib/auth', () => ({
  loadAuth: vi.fn(),
  getApiKey: vi.fn(),
  getApiUrl: vi.fn(),
  saveAuth: vi.fn(),
  clearAuth: vi.fn(),
  hasStoredAuth: vi.fn(),
  maskKey: vi.fn().mockImplementation((k: string) => k.slice(0, 4) + '***'),
  getProvider: vi.fn().mockReturnValue('minimax'),
  getProviderModel: vi.fn().mockReturnValue('MiniMax-M2.5'),
}));

vi.mock('../src/lib/providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/providers')>();
  return {
    ...mod,
    getAdapter: (config: Parameters<typeof mod.getAdapter>[0]) => mod.getAdapter(config),
    getProviderApiKey: vi.fn() as ReturnType<typeof mod.getProviderApiKey>,
    getProviderEnvVar: vi.fn().mockImplementation((provider: string) => {
      const map: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        groq: 'GROQ_API_KEY',
        mistral: 'MISTRAL_API_KEY',
        minimax: 'MINIMAX_API_KEY',
        together: 'TOGETHER_API_KEY',
        ollama: '',
        custom: 'CUSTOM_API_KEY',
      };
      return map[provider] ?? 'MINIMAX_API_KEY';
    }),
    ProviderError: mod.ProviderError,
  };
});

const server = setupServer();

const defaultAuth = {
  apiKey: 'test-key',
  apiUrl: 'https://api.drill.dev',
  plan: 'free' as const,
  runCount: 0,
  runLimit: 20,
  provider: 'minimax' as const,
  providerModel: 'MiniMax-M2.5' as const,
  model: 'cloud' as const,
  localModel: undefined as string | undefined,
  redact: true,
  customUrl: undefined as string | undefined,
};

describe('api', () => {
  describe('analyze', () => {
    beforeEach(() => {
      vi.mocked(loadAuth).mockReturnValue(defaultAuth);
      vi.mocked(getProviderApiKey).mockReturnValue('test-key');
      server.listen({ onUnhandledRequest: 'warn' });
    });

    afterEach(() => {
      server.close();
      vi.resetAllMocks();
    });

    it('returns NO_KEY when no API key and not ollama', async () => {
      vi.mocked(getProviderApiKey).mockReturnValue('');
      vi.mocked(loadAuth).mockReturnValue({ ...defaultAuth, apiKey: '', provider: 'openai' });

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'NO_KEY',
        message: 'No API key configured. Set OPENAI_API_KEY in your environment.',
      });
    });

    it('uses stored config apiKey when provider env var is empty', async () => {
      vi.mocked(getProviderApiKey).mockImplementation((config) => config.apiKey);
      server.use(
        http.post('https://api.minimax.io/v1/chat/completions', ({ request }) => {
          expect(request.headers.get('authorization')).toBe('Bearer test-key');
          return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
        })
      );

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'INVALID_KEY',
      });
    });

    it('returns INVALID_KEY on 401 response', async () => {
      server.use(
        http.post('https://api.minimax.io/v1/chat/completions', () => {
          return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
        })
      );

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'INVALID_KEY',
      });
    });

    it('returns INVALID_KEY on 403 response', async () => {
      server.use(
        http.post('https://api.minimax.io/v1/chat/completions', () => {
          return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
        })
      );

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'INVALID_KEY',
      });
    });

    it('returns LIMIT_REACHED on 429 response', async () => {
      server.use(
        http.post('https://api.minimax.io/v1/chat/completions', () => {
          return HttpResponse.json(
            { error: 'Rate limit exceeded', upgrade: 'https://drill.dev/upgrade' },
            { status: 429 }
          );
        })
      );

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'LIMIT_REACHED',
        upgrade_url: 'https://drill.dev/upgrade',
      });
    });

    it('returns PROVIDER_ERROR on 500 response', async () => {
      server.use(
        http.post('https://api.minimax.io/v1/chat/completions', () => {
          return HttpResponse.json({ error: 'Internal server error' }, { status: 500 });
        })
      );

      const result = await analyze({ input: 'test error' });

      expect(result).toMatchObject({
        code: 'PROVIDER_ERROR',
      });
    });
  });
});
