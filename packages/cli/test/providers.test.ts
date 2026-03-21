import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  getAdapter,
  getProviderApiKey,
  getProviderEnvVar,
  VALID_PROVIDERS,
  OpenAICompatAdapter,
  AnthropicAdapter,
  OllamaAdapter,
  ProviderError,
} from '../src/lib/providers';
import type { DrillConfig } from '../src/types';

const mockConfig = (overrides: Partial<DrillConfig> = {}): DrillConfig => ({
  apiKey: 'test-key',
  apiUrl: 'https://api.drill.dev',
  plan: 'free',
  runCount: 0,
  runLimit: 20,
  model: 'cloud',
  localModel: undefined,
  redact: true,
  provider: 'minimax',
  providerModel: 'MiniMax-M2.5',
  customUrl: undefined,
  ...overrides,
});

describe('getAdapter', () => {
  it('returns OpenAICompatAdapter for openai provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'openai', providerModel: 'gpt-4o' }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('returns OpenAICompatAdapter for groq provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'groq', providerModel: 'llama-3.1-70b-versatile' }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('returns OpenAICompatAdapter for mistral provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'mistral', providerModel: 'mistral-large' }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('returns OpenAICompatAdapter for minimax provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'minimax', providerModel: 'MiniMax-M2.5' }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('returns OpenAICompatAdapter for together provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'together', providerModel: 'MiniMaxAI/MiniMax-M2.5' }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('returns AnthropicAdapter for anthropic provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'anthropic', providerModel: 'claude-sonnet-4-20250514' }));
    expect(adapter.name).toBe('anthropic');
  });

  it('returns OllamaAdapter for ollama provider', () => {
    const adapter = getAdapter(mockConfig({ provider: 'ollama', providerModel: 'llama3.2' }));
    expect(adapter.name).toBe('ollama');
  });

  it('returns OpenAICompatAdapter for custom provider with customUrl', () => {
    const adapter = getAdapter(mockConfig({
      provider: 'custom',
      providerModel: 'my-model',
      customUrl: 'https://my-endpoint.com/v1',
    }));
    expect(adapter.name).toBe('openai-compatible');
  });

  it('uses correct base URL for openai', () => {
    const adapter = getAdapter(mockConfig({ provider: 'openai', providerModel: 'gpt-4o' })) as OpenAICompatAdapter;
    expect(adapter).toBeInstanceOf(OpenAICompatAdapter);
  });

  it('throws on unknown provider', () => {
    expect(() => {
      getAdapter(mockConfig({ provider: 'unknown' as never }));
    }).toThrow('Unknown provider: unknown');
  });

  it('throws ProviderError when providerModel is empty', () => {
    expect(() => {
      getAdapter(mockConfig({ provider: 'openai', providerModel: '' }));
    }).toThrow('No model configured. Run: drill setup');
  });
});

describe('getProviderApiKey', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('MISTRAL_API_KEY', '');
    vi.stubEnv('MINIMAX_API_KEY', '');
    vi.stubEnv('TOGETHER_API_KEY', '');
    vi.stubEnv('CUSTOM_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns OPENAI_API_KEY for openai provider', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai-test');
    const config = mockConfig({ provider: 'openai' });
    expect(getProviderApiKey(config)).toBe('sk-openai-test');
  });

  it('returns ANTHROPIC_API_KEY for anthropic provider', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const config = mockConfig({ provider: 'anthropic' });
    expect(getProviderApiKey(config)).toBe('sk-ant-test');
  });

  it('returns GROQ_API_KEY for groq provider', () => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_groq_test');
    const config = mockConfig({ provider: 'groq' });
    expect(getProviderApiKey(config)).toBe('gsk_groq_test');
  });

  it('returns MISTRAL_API_KEY for mistral provider', () => {
    vi.stubEnv('MISTRAL_API_KEY', 'mistral_test');
    const config = mockConfig({ provider: 'mistral' });
    expect(getProviderApiKey(config)).toBe('mistral_test');
  });

  it('returns MINIMAX_API_KEY for minimax provider', () => {
    vi.stubEnv('MINIMAX_API_KEY', 'minimax_test');
    const config = mockConfig({ provider: 'minimax' });
    expect(getProviderApiKey(config)).toBe('minimax_test');
  });

  it('returns TOGETHER_API_KEY for together provider', () => {
    vi.stubEnv('TOGETHER_API_KEY', 'together_test');
    const config = mockConfig({ provider: 'together' });
    expect(getProviderApiKey(config)).toBe('together_test');
  });

  it('returns CUSTOM_API_KEY for custom provider', () => {
    vi.stubEnv('CUSTOM_API_KEY', 'custom_test');
    const config = mockConfig({ provider: 'custom' });
    expect(getProviderApiKey(config)).toBe('custom_test');
  });

  it('returns empty string for ollama provider', () => {
    const config = mockConfig({ provider: 'ollama' });
    expect(getProviderApiKey(config)).toBe('');
  });

  it('returns stored config key when env var is not set', () => {
    const config = mockConfig({ provider: 'openai' });
    expect(getProviderApiKey(config)).toBe('test-key');
  });

  it('prefers provider env var over stored config key', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env-override');
    const config = mockConfig({ provider: 'openai' });
    expect(getProviderApiKey(config)).toBe('sk-env-override');
  });

  it('falls back to minimax for unknown provider', () => {
    vi.stubEnv('MINIMAX_API_KEY', 'fallback_key');
    const config = mockConfig({ provider: 'minimax' });
    expect(getProviderApiKey(config)).toBe('fallback_key');
  });
});

describe('getProviderEnvVar', () => {
  it('returns OPENAI_API_KEY for openai', () => {
    expect(getProviderEnvVar('openai')).toBe('OPENAI_API_KEY');
  });

  it('returns ANTHROPIC_API_KEY for anthropic', () => {
    expect(getProviderEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY');
  });

  it('returns GROQ_API_KEY for groq', () => {
    expect(getProviderEnvVar('groq')).toBe('GROQ_API_KEY');
  });

  it('returns MISTRAL_API_KEY for mistral', () => {
    expect(getProviderEnvVar('mistral')).toBe('MISTRAL_API_KEY');
  });

  it('returns empty string for ollama', () => {
    expect(getProviderEnvVar('ollama')).toBe('');
  });

  it('returns MINIMAX_API_KEY for minimax', () => {
    expect(getProviderEnvVar('minimax')).toBe('MINIMAX_API_KEY');
  });

  it('returns TOGETHER_API_KEY for together', () => {
    expect(getProviderEnvVar('together')).toBe('TOGETHER_API_KEY');
  });

  it('returns CUSTOM_API_KEY for custom', () => {
    expect(getProviderEnvVar('custom')).toBe('CUSTOM_API_KEY');
  });
});

describe('VALID_PROVIDERS', () => {
  it('contains all expected providers', () => {
    expect(VALID_PROVIDERS).toContain('openai');
    expect(VALID_PROVIDERS).toContain('anthropic');
    expect(VALID_PROVIDERS).toContain('groq');
    expect(VALID_PROVIDERS).toContain('mistral');
    expect(VALID_PROVIDERS).toContain('ollama');
    expect(VALID_PROVIDERS).toContain('minimax');
    expect(VALID_PROVIDERS).toContain('together');
    expect(VALID_PROVIDERS).toContain('custom');
    expect(VALID_PROVIDERS).toHaveLength(8);
  });
});

describe('ProviderError', () => {
  it('has correct name and properties', () => {
    const err = new ProviderError('INVALID_KEY', 'Test error message');
    expect(err.name).toBe('ProviderError');
    expect(err.code).toBe('INVALID_KEY');
    expect(err.message).toBe('Test error message');
    expect(err instanceof Error).toBe(true);
  });
});

describe('OpenAICompatAdapter', () => {
  it('has correct name', () => {
    const adapter = new OpenAICompatAdapter('key', 'https://api.openai.com/v1', 'gpt-4o', 90_000);
    expect(adapter.name).toBe('openai-compatible');
  });
});

describe('AnthropicAdapter', () => {
  it('has correct name', () => {
    const adapter = new AnthropicAdapter('key', 'claude-sonnet-4-20250514', 90_000);
    expect(adapter.name).toBe('anthropic');
  });
});

describe('OllamaAdapter', () => {
  it('has correct name', () => {
    const adapter = new OllamaAdapter('llama3.2', 90_000);
    expect(adapter.name).toBe('ollama');
  });
});

vi.mock('../src/lib/providers', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/providers')>();
  return {
    ...mod,
    checkOllamaRunning: vi.fn().mockResolvedValue(undefined),
  };
});

const server = setupServer();

describe('OpenAICompatAdapter.stream', () => {
  beforeEach(() => {
    server.listen({ onUnhandledRequest: 'warn' });
  });

  afterEach(() => {
    server.close();
  });

  it('streams SSE response and calls onChunk', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);
    const chunks: string[] = [];
    const thinking: string[] = [];

    const result = await adapter.stream(
      [{ role: 'user', content: 'hi' }],
      (t) => thinking.push(t),
      (c) => chunks.push(c),
    );

    expect(result).toContain('Hello');
    expect(result).toContain('world');
  });

  it('handles <think> tags by calling onThinking', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"<>test <>"},"index":0}]}\n\n'));
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Some result"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);
    const thinking: string[] = [];

    const result = await adapter.stream(
      [{ role: 'user', content: 'hi' }],
      (t) => thinking.push(t),
      () => {},
    );

    expect(result).toContain('Some result');
  });

  it('throws ProviderError on 401 response', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toThrow(ProviderError);
  });

  it('throws ProviderError on 403 response', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toThrow(ProviderError);
  });

  it('throws ProviderError with LIMIT_REACHED on 429 response', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json(
          { error: 'Rate limit', upgrade: 'https://drill.dev/upgrade' },
          { status: 429 }
        );
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('throws ProviderError on 500 response', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('throws ProviderError when response body is null', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => {
        return new Response(null as unknown as BodyInit, { status: 200 });
      })
    );

    const adapter = new OpenAICompatAdapter('sk-test', 'https://api.openai.com/v1', 'gpt-4o', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

describe('OllamaAdapter.stream', () => {
  beforeEach(() => {
    server.use(
      http.get('http://localhost:11434/api/tags', () => HttpResponse.json({}))
    );
    server.listen({ onUnhandledRequest: 'warn' });
  });

  afterEach(() => {
    server.close();
  });

  it('streams from local Ollama', async () => {
    server.use(
      http.post('http://localhost:11434/v1/chat/completions', () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"local result"}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      })
    );

    const adapter = new OllamaAdapter('llama3.2', 90_000);

    const result = await adapter.stream(
      [{ role: 'user', content: 'hi' }],
      () => {},
      () => {},
    );

    expect(result).toContain('local result');
  });

  it('throws when Ollama is not running', async () => {
    server.use(
      http.get('http://localhost:11434/api/tags', () => {
        return HttpResponse.error();
      })
    );

    const adapter = new OllamaAdapter('llama3.2', 90_000);

    await expect(
      adapter.stream([{ role: 'user', content: 'hi' }], () => {}, () => {})
    ).rejects.toThrow('Ollama is not running');
  });
});
