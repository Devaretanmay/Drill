/**
 * Provider Registry Module
 *
 * Defines the LLMAdapter interface and implements adapters for all
 * supported LLM providers. Drill is fully provider-agnostic.
 */

import { createParser } from 'eventsource-parser';
import type { ChatMessage, DrillConfig, ProviderName } from '../types.js';

export type { ChatMessage };

export interface LLMAdapter {
  name: string;
  stream(
    messages: ChatMessage[],
    onThinking: (text: string) => void,
    onChunk: (text: string) => void,
  ): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI-compatible adapter (handles OpenAI, Groq, Mistral, MiniMax, Together,
// and any OpenAI-compatible endpoint)
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAICompatAdapter implements LLMAdapter {
  name = 'openai-compatible';

  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private timeoutMs: number,
  ) {}

  async stream(
    messages: ChatMessage[],
    onThinking: (text: string) => void,
    onChunk: (text: string) => void,
  ): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const signal = AbortSignal.timeout(this.timeoutMs);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 40,
        messages,
      }),
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('INVALID_KEY', 'API key rejected. Check your API key.');
    }

    if (response.status === 429) {
      const body = await response.json().catch(() => ({})) as { upgrade?: string };
      const upgradeUrl = body?.upgrade ?? 'https://drill.dev/upgrade';
      throw new ProviderError('LIMIT_REACHED', upgradeUrl);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError('PROVIDER_ERROR', `HTTP ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new ProviderError('PROVIDER_ERROR', 'Response body is null');
    }

    return parseOpenAISSE(response.body, onThinking, onChunk);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic adapter
// ─────────────────────────────────────────────────────────────────────────────

export class AnthropicAdapter implements LLMAdapter {
  name = 'anthropic';

  constructor(
    private apiKey: string,
    private model: string,
    private timeoutMs: number,
  ) {}

  async stream(
    messages: ChatMessage[],
    onThinking: (text: string) => void,
    onChunk: (text: string) => void,
  ): Promise<string> {
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const anthropicMessages = nonSystemMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      stream: true,
      messages: anthropicMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    const signal = AbortSignal.timeout(this.timeoutMs);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 401) {
      throw new ProviderError('INVALID_KEY', 'API key rejected. Check your ANTHROPIC_API_KEY.');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new ProviderError('PROVIDER_ERROR', `HTTP ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new ProviderError('PROVIDER_ERROR', 'Response body is null');
    }

    return parseAnthropicSSE(response.body, onThinking, onChunk);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ollama adapter
// ─────────────────────────────────────────────────────────────────────────────

export class OllamaAdapter implements LLMAdapter {
  name = 'ollama';

  constructor(
    private model: string,
    private timeoutMs: number,
  ) {}

  async stream(
    messages: ChatMessage[],
    onThinking: (text: string) => void,
    onChunk: (text: string) => void,
  ): Promise<string> {
    await checkOllamaRunning();

    const adapter = new OpenAICompatAdapter(
      '',
      'http://localhost:11434/v1',
      this.model,
      this.timeoutMs,
    );

    return adapter.stream(messages, onThinking, onChunk);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider factory
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  minimax: 'https://api.minimax.io/v1',
  together: 'https://api.together.xyz/v1',
};

const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  groq: 'llama-3.1-70b-versatile',
  mistral: 'mistral-large-latest',
  ollama: 'llama3.2',
  minimax: 'MiniMax-M2.5',
  together: 'MiniMaxAI/MiniMax-M2.5',
};

export const VALID_PROVIDERS: ProviderName[] = [
  'openai', 'anthropic', 'groq', 'mistral', 'ollama', 'minimax', 'together', 'custom',
];

/**
 * Returns the correct adapter for the given DrillConfig.
 */
export function getAdapter(config: DrillConfig): LLMAdapter {
  const timeoutMs = 90_000;

  switch (config.provider) {
    case 'anthropic': {
      const apiKey = getProviderApiKey(config);
      const model = config.providerModel || PROVIDER_DEFAULT_MODELS['anthropic'] || 'claude-sonnet-4-20250514';
      return new AnthropicAdapter(apiKey, model, timeoutMs);
    }

    case 'ollama': {
      const model = config.providerModel || PROVIDER_DEFAULT_MODELS['ollama'] || 'llama3.2';
      return new OllamaAdapter(model, timeoutMs);
    }

    case 'openai':
    case 'groq':
    case 'mistral':
    case 'minimax':
    case 'together': {
      const baseUrl = PROVIDER_BASE_URLS[config.provider] ?? '';
      const apiKey = getProviderApiKey(config);
      const model = config.providerModel || PROVIDER_DEFAULT_MODELS[config.provider] || config.providerModel;
      return new OpenAICompatAdapter(apiKey, baseUrl, model, timeoutMs);
    }

    case 'custom': {
      const baseUrl = config.customUrl ?? '';
      const apiKey = getProviderApiKey(config);
      return new OpenAICompatAdapter(apiKey, baseUrl, config.providerModel || 'gpt-4o', timeoutMs);
    }

    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

/**
 * Returns the correct env var name for the API key of the given provider.
 */
export function getProviderApiKey(config: DrillConfig): string {
  const provider = config.provider ?? 'minimax';

  switch (provider) {
    case 'openai': return process.env['OPENAI_API_KEY'] ?? '';
    case 'anthropic': return process.env['ANTHROPIC_API_KEY'] ?? '';
    case 'groq': return process.env['GROQ_API_KEY'] ?? '';
    case 'mistral': return process.env['MISTRAL_API_KEY'] ?? '';
    case 'ollama': return '';
    case 'minimax': return process.env['MINIMAX_API_KEY'] ?? '';
    case 'together': return process.env['TOGETHER_API_KEY'] ?? '';
    case 'custom': return process.env['CUSTOM_API_KEY'] ?? '';
  }
}

/**
 * Gets the env var name for a given provider (for error messages).
 */
export function getProviderEnvVar(provider: ProviderName): string {
  switch (provider) {
    case 'openai': return 'OPENAI_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'groq': return 'GROQ_API_KEY';
    case 'mistral': return 'MISTRAL_API_KEY';
    case 'ollama': return '';
    case 'minimax': return 'MINIMAX_API_KEY';
    case 'together': return 'TOGETHER_API_KEY';
    case 'custom': return 'CUSTOM_API_KEY';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

async function checkOllamaRunning(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_000);

    const response = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw new Error('Ollama is not running. Start it with: ollama serve');
  }
}

async function parseOpenAISSE(
  body: ReadableStream<Uint8Array>,
  onThinking: (text: string) => void,
  onChunk: (text: string) => void,
): Promise<string> {
  let inThink = false;
  let resultBuffer = '';

  const parser = createParser({
    onEvent(event) {
      if (event.data === '[DONE]') return;

      let parsed: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        parsed = JSON.parse(event.data) as typeof parsed;
      } catch {
        return;
      }

      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (!delta) return;

      let i = 0;
      while (i < delta.length) {
        if (!inThink) {
          const thinkStart = delta.indexOf('<think>', i);
          if (thinkStart === -1) {
            resultBuffer += delta.slice(i);
            onChunk(delta.slice(i));
            break;
          } else {
            const beforeThink = delta.slice(i, thinkStart);
            if (beforeThink) {
              resultBuffer += beforeThink;
              onChunk(beforeThink);
            }
            inThink = true;
            i = thinkStart + '<think>'.length;
          }
        } else {
          const thinkEnd = delta.indexOf('</think>', i);
          if (thinkEnd === -1) {
            const thinkContent = delta.slice(i);
            onThinking(thinkContent);
            break;
          } else {
            const thinkContent = delta.slice(i, thinkEnd);
            if (thinkContent) {
              onThinking(thinkContent);
            }
            inThink = false;
            i = thinkEnd + '</think>'.length;
          }
        }
      }
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Stream read failed';
    throw new ProviderError('NETWORK', msg);
  } finally {
    reader.releaseLock();
  }

  return resultBuffer.trim();
}

async function parseAnthropicSSE(
  body: ReadableStream<Uint8Array>,
  onThinking: (text: string) => void,
  onChunk: (text: string) => void,
): Promise<string> {
  let resultBuffer = '';

  const parser = createParser({
    onEvent(event) {
      if (!event.data || event.data === '[DONE]') return;

      let parsed: {
        type: string;
        delta?: { type: string; text?: string; thinking?: string };
      };
      try {
        parsed = JSON.parse(event.data) as typeof parsed;
      } catch {
        return;
      }

      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta;
        if (delta?.type === 'thinking_delta' && delta.thinking) {
          onThinking(delta.thinking);
        } else if (delta?.type === 'text_delta' && delta.text) {
          resultBuffer += delta.text;
          onChunk(delta.text);
        }
      }
    },
  });

  const reader = body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Stream read failed';
    throw new ProviderError('NETWORK', msg);
  } finally {
    reader.releaseLock();
  }

  return resultBuffer.trim();
}
