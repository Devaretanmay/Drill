/**
 * API Client Module
 *
 * HTTP client for LLM API with streaming, retry logic, and provider abstraction.
 * All provider-specific logic lives in providers.ts.
 */

import { loadAuth } from './auth.js';
import {
  getAdapter,
  getProviderApiKey,
  getProviderEnvVar,
  ProviderError,
} from './providers.js';
import { buildUserPrompt, SYSTEM_PROMPT, parseResult, PARSE_RETRY_SUFFIX } from './prompts.js';
import type { DrillResult, DrillError, StreamCallbacks, DrillConfig } from '../types.js';

export interface AnalyzeOptions {
  input: string;
  context?: string;
  onThinking?: (text: string) => void;
  onResultChunk?: (text: string) => void;
  timeoutMs?: number;
  providerOverride?: DrillConfig['provider'];
  providerModelOverride?: string;
}

/**
 * Loads full auth config with provider defaults.
 */
function loadConfig(options: AnalyzeOptions): DrillConfig {
  const auth = loadAuth();
  const provider = options.providerOverride ?? auth?.provider ?? 'minimax';
  const providerModel = options.providerModelOverride
    ?? (provider === 'ollama'
      ? auth?.localModel ?? auth?.providerModel ?? 'llama3.2'
      : auth?.providerModel ?? 'MiniMax-M2.5');

  return {
    apiKey: auth?.apiKey ?? '',
    apiUrl: auth?.apiUrl ?? 'https://api.drill.dev',
    plan: auth?.plan ?? 'free',
    runCount: auth?.runCount ?? 0,
    runLimit: auth?.runLimit ?? 20,
    model: auth?.model ?? 'cloud',
    localModel: auth?.localModel,
    redact: auth?.redact ?? true,
    provider,
    providerModel,
    customUrl: auth?.customUrl,
  };
}

/**
 * Analyzes log input using the configured LLM provider.
 * Handles streaming, parsing, and retry on parse failure.
 *
 * @param options Analysis options including input and streaming callbacks
 * @returns DrillResult on success, DrillError on failure
 */
export async function analyze(
  options: AnalyzeOptions,
): Promise<DrillResult | DrillError> {
  const config = loadConfig(options);
  const provider = config.provider;

  const apiKey = getProviderApiKey(config);

  if (!apiKey && provider !== 'ollama') {
    const envVar = getProviderEnvVar(provider);
    return {
      code: 'NO_KEY',
      message: `No API key configured. Set ${envVar} in your environment.`,
    } satisfies DrillError;
  }

  const adapter = getAdapter(config, options.timeoutMs ?? 90_000);

  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(options.input, options.context);

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  const callbacks: StreamCallbacks = {
    onThinking: options.onThinking ?? (() => undefined),
    onResultChunk: options.onResultChunk ?? (() => undefined),
  };

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const resultText = await adapter.stream(messages, callbacks.onThinking, callbacks.onResultChunk);

      try {
        const parsed = parseResult(resultText);
        return parsed;
      } catch (parseErr: unknown) {
        if (attempt === 0) {
          messages[0]!.content = systemPrompt + PARSE_RETRY_SUFFIX;
          continue;
        }
        const msg = parseErr instanceof Error ? parseErr.message : 'Parse failed';
        return {
          code: 'PARSE_FAILED',
          message: `Failed to parse LLM response: ${msg}`,
        } satisfies DrillError;
      }
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        if (err.code === 'INVALID_KEY') {
          return {
            code: 'INVALID_KEY',
            message: err.message,
          } satisfies DrillError;
        }
        if (err.code === 'PROVIDER_ERROR') {
          return {
            code: 'PROVIDER_ERROR',
            message: err.message,
          } satisfies DrillError;
        }
        if (err.code === 'LIMIT_REACHED') {
          return {
            code: 'LIMIT_REACHED',
            message: err.message,
            upgrade_url: err.message,
          } satisfies DrillError;
        }
        if (err.code === 'NETWORK') {
          return {
            code: 'NETWORK',
            message: err.message,
          } satisfies DrillError;
        }
      }

      if (err instanceof Error) {
        if (err.name === 'AbortError' || err.message.includes('aborted')) {
          return {
            code: 'TIMEOUT',
            message: 'Request timed out. Use --timeout 120 to allow more time.',
          } satisfies DrillError;
        }
        return {
          code: 'NETWORK',
          message: err.message,
        } satisfies DrillError;
      }

      return {
        code: 'API_ERROR',
        message: 'An unexpected error occurred.',
      } satisfies DrillError;
    }
  }

  return {
    code: 'PARSE_FAILED',
    message: 'Failed to parse LLM response after retries.',
  } satisfies DrillError;
}

/**
 * @deprecated Use analyze() instead. Kept for backward compatibility.
 */
export async function analyzeWithOptions(
  input: string,
  callbacks: Pick<StreamCallbacks, 'onThinking' | 'onResultChunk'>,
): Promise<DrillResult | DrillError> {
  return analyze({ input, ...callbacks });
}
