export type ProviderId =
  | 'openai' | 'anthropic' | 'groq' | 'mistral'
  | 'minimax' | 'together' | 'ollama' | 'custom';

export class ModelFetchError extends Error {
  override readonly name = 'ModelFetchError';
  constructor(
    message: string,
    readonly code: 'INVALID_KEY' | 'NETWORK' | 'NOT_SUPPORTED',
  ) { super(message); }
}

const TIMEOUT_MS = 8_000;

export async function fetchModels(
  provider: ProviderId,
  apiKey: string,
): Promise<string[]> {
  switch (provider) {
    case 'openai':    return fetchOpenAI(apiKey);
    case 'anthropic': return fetchAnthropic();
    case 'groq':      return fetchOpenAICompat('https://api.groq.com/openai/v1/models', apiKey);
    case 'mistral':   return fetchOpenAICompat('https://api.mistral.ai/v1/models', apiKey);
    case 'together':  return fetchTogether(apiKey);
    case 'minimax':   return ['MiniMax-M2.5', 'MiniMax-M2', 'abab6.5s-chat', 'abab5.5-chat'];
    case 'ollama':    return fetchOllama();
    case 'custom':    return [];
    default:          return [];
  }
}

async function fetchOpenAI(apiKey: string): Promise<string[]> {
  const data = await getJson('https://api.openai.com/v1/models', apiKey);
  const models = (data as { data: Array<{ id: string }> }).data
    .map(m => m.id)
    .filter(id => /^(gpt-|o1|o3|chatgpt-)/.test(id))
    .sort()
    .reverse();
  return models;
}

function fetchAnthropic(): Promise<string[]> {
  return Promise.resolve([
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
    'claude-opus-4',
    'claude-sonnet-4',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ]);
}

async function fetchOpenAICompat(url: string, apiKey: string): Promise<string[]> {
  const data = await getJson(url, apiKey);
  return (data as { data: Array<{ id: string }> }).data
    .map(m => m.id)
    .sort();
}

async function fetchTogether(apiKey: string): Promise<string[]> {
  const data = await getJson('https://api.together.xyz/v1/models', apiKey);
  return (data as Array<{ id: string; type?: string }>)
    .filter(m => !m.type || m.type === 'chat' || m.type === 'language')
    .map(m => m.id)
    .sort();
}

async function fetchOllama(): Promise<string[]> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models.map(m => m.name).sort();
  } catch {
    throw new ModelFetchError(
      'Ollama is not running. Start it with: ollama serve',
      'NETWORK',
    );
  }
}

async function getJson(url: string, apiKey: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: unknown) {
    throw new ModelFetchError(
      e instanceof Error ? e.message : 'Network error',
      'NETWORK',
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new ModelFetchError('Invalid API key', 'INVALID_KEY');
  }
  if (!res.ok) {
    throw new ModelFetchError(`HTTP ${res.status}`, 'NETWORK');
  }
  return res.json();
}
