import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { updateAuth, loadAuth, clearAuth } from '../../src/lib/auth';
import { VALID_PROVIDERS } from '../../src/lib/providers';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue('127.0.0.1'),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

const defaultModels = ['model-a', 'model-b'];
vi.mock('../../src/lib/models', () => ({
  fetchModels: vi.fn().mockImplementation((provider: string) => {
    if (provider === 'custom') return Promise.resolve([]);
    return Promise.resolve(defaultModels);
  }),
  ModelFetchError: class extends Error {
    code: string;
    constructor(msg: string, code: string) {
      super(msg);
      this.code = code;
    }
  },
}));

const mockRl = {
  question: vi.fn(),
  close: vi.fn(),
};

vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue(mockRl),
}));

describe('setup auth integration', () => {
  beforeEach(() => {
    process.env['DRILL_CONFIG_DIR'] = '/tmp/drill-test-setup';
    clearAuth();
  });

  afterEach(() => {
    clearAuth();
    vi.unstubAllEnvs();
  });

  it('updateAuth saves provider as openai', () => {
    updateAuth({ provider: 'openai', providerModel: 'gpt-4o', apiKey: 'sk-test' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('openai');
    expect(auth?.providerModel).toBe('gpt-4o');
    expect(auth?.apiKey).toBe('sk-test');
  });

  it('updateAuth saves provider as anthropic', () => {
    updateAuth({ provider: 'anthropic', providerModel: 'claude-sonnet-4-20250514', apiKey: 'sk-ant-test' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('anthropic');
    expect(auth?.providerModel).toBe('claude-sonnet-4-20250514');
  });

  it('updateAuth saves provider as groq', () => {
    updateAuth({ provider: 'groq', providerModel: 'llama-3.1-70b-versatile', apiKey: 'gsk_test' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('groq');
    expect(auth?.providerModel).toBe('llama-3.1-70b-versatile');
  });

  it('updateAuth saves provider as ollama with no api key', () => {
    updateAuth({ provider: 'ollama', providerModel: 'llama3.2', apiKey: '' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('ollama');
    expect(auth?.providerModel).toBe('llama3.2');
    expect(auth?.apiKey).toBe('');
  });

  it('updateAuth saves provider as minimax', () => {
    updateAuth({ provider: 'minimax', providerModel: 'MiniMax-M2.5', apiKey: 'minimax_test' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('minimax');
    expect(auth?.providerModel).toBe('MiniMax-M2.5');
  });

  it('updateAuth saves provider as custom with customUrl', () => {
    updateAuth({ provider: 'custom', providerModel: 'my-model', apiKey: 'custom_test', customUrl: 'https://my-api.com/v1' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('custom');
    expect(auth?.providerModel).toBe('my-model');
    expect(auth?.apiKey).toBe('custom_test');
    expect(auth?.customUrl).toBe('https://my-api.com/v1');
  });

  it('updateAuth preserves existing fields when only updating provider', () => {
    updateAuth({ provider: 'openai', providerModel: 'gpt-4o', apiKey: 'sk-test' });
    updateAuth({ provider: 'groq', providerModel: 'llama-3.1-70b-versatile' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('groq');
    expect(auth?.providerModel).toBe('llama-3.1-70b-versatile');
    expect(auth?.apiKey).toBe('sk-test');
  });

  it('updateAuth defaults to minimax when no existing auth', () => {
    updateAuth({ provider: 'minimax', providerModel: 'MiniMax-M2.5', apiKey: 'minimax_test' });
    const auth = loadAuth();
    expect(auth?.provider).toBe('minimax');
    expect(auth?.providerModel).toBe('MiniMax-M2.5');
  });
});

describe('VALID_PROVIDERS', () => {
  it('includes all 8 providers', () => {
    expect(VALID_PROVIDERS).toHaveLength(8);
    expect(VALID_PROVIDERS).toContain('openai');
    expect(VALID_PROVIDERS).toContain('anthropic');
    expect(VALID_PROVIDERS).toContain('groq');
    expect(VALID_PROVIDERS).toContain('mistral');
    expect(VALID_PROVIDERS).toContain('ollama');
    expect(VALID_PROVIDERS).toContain('minimax');
    expect(VALID_PROVIDERS).toContain('together');
    expect(VALID_PROVIDERS).toContain('custom');
  });
});

describe('setup command exports', () => {
  it('setupCommand is a function', async () => {
    const { setupCommand } = await import('../../src/commands/setup');
    expect(typeof setupCommand).toBe('function');
  });
});

describe('setupCommand interactive flow', () => {
  beforeEach(() => {
    process.env['DRILL_CONFIG_DIR'] = '/tmp/drill-test-setup-interactive';
    clearAuth();
    vi.clearAllMocks();
    mockRl.close.mockClear();
  });

  afterEach(() => {
    clearAuth();
  });

  it('selects OpenAI provider and saves auth', async () => {
    const { setupCommand } = await import('../../src/commands/setup');

    let resolveQuestion: (value: string) => void;
    mockRl.question.mockImplementation((_: string, cb: (ans: string) => void) => {
      resolveQuestion = cb;
    });

    const runPromise = setupCommand();

    resolveQuestion!('1');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('sk-test-key');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('1');
    await runPromise;

    const auth = loadAuth();
    expect(auth?.provider).toBe('openai');
    expect(auth?.providerModel).toBe('model-a');
  });

  it('selects Ollama provider (no API key)', async () => {
    const { setupCommand } = await import('../../src/commands/setup');

    let resolveQuestion: (value: string) => void;
    mockRl.question.mockImplementation((_: string, cb: (ans: string) => void) => {
      resolveQuestion = cb;
    });

    const runPromise = setupCommand();

    resolveQuestion!('5');
    await new Promise(r => setTimeout(r, 0));
    await runPromise;

    const auth = loadAuth();
    expect(auth?.provider).toBe('ollama');
  });

  it('selects MiniMax provider', async () => {
    const { setupCommand } = await import('../../src/commands/setup');

    let resolveQuestion: (value: string) => void;
    mockRl.question.mockImplementation((_: string, cb: (ans: string) => void) => {
      resolveQuestion = cb;
    });

    const runPromise = setupCommand();

    resolveQuestion!('6');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('minimax-key');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('1');
    await runPromise;

    const auth = loadAuth();
    expect(auth?.provider).toBe('minimax');
  });

  it('selects Custom provider with URL and manual model entry', async () => {
    const { setupCommand } = await import('../../src/commands/setup');

    let resolveQuestion: (value: string) => void;
    mockRl.question.mockImplementation((_: string, cb: (ans: string) => void) => {
      resolveQuestion = cb;
    });

    const runPromise = setupCommand();

    resolveQuestion!('8');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('https://my-endpoint.com/v1');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('custom-key');
    await new Promise(r => setTimeout(r, 0));
    resolveQuestion!('my-custom-model');
    await runPromise;

    const auth = loadAuth();
    expect(auth?.provider).toBe('custom');
    expect(auth?.customUrl).toBe('https://my-endpoint.com/v1');
    expect(auth?.providerModel).toBe('my-custom-model');
  });
});
