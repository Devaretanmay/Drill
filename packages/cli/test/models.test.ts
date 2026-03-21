import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchModels } from '../../src/lib/models';

const server = setupServer(
  http.get('https://api.openai.com/v1/models', ({ request }) => {
    const auth = request.headers.get('authorization');
    if (auth !== 'Bearer valid-openai') return HttpResponse.json({}, { status: 401 });
    return HttpResponse.json({
      data: [
        { id: 'gpt-4o' },
        { id: 'gpt-3.5-turbo' },
        { id: 'dall-e-3' },
        { id: 'o1-preview' },
        { id: 'whisper-1' },
      ],
    });
  }),
  http.get('https://api.groq.com/openai/v1/models', () =>
    HttpResponse.json({ data: [{ id: 'llama-3.1-70b' }, { id: 'gemma2-9b' }] }),
  ),
  http.get('https://api.together.xyz/v1/models', () =>
    HttpResponse.json([
      { id: 'meta-llama/Llama-3', type: 'chat' },
      { id: 'stabilityai/sd-3', type: 'image' },
    ]),
  ),
  http.get('http://localhost:11434/api/tags', () =>
    HttpResponse.json({ models: [{ name: 'llama3:7b' }, { name: 'codellama:13b' }] }),
  ),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('fetchModels', () => {
  it('filters OpenAI to only gpt/o1/o3/chatgpt models', async () => {
    const models = await fetchModels('openai', 'valid-openai');
    expect(models).toContain('gpt-4o');
    expect(models).toContain('gpt-3.5-turbo');
    expect(models).toContain('o1-preview');
    expect(models).not.toContain('dall-e-3');
    expect(models).not.toContain('whisper-1');
  });

  it('returns static list for Anthropic without network call', async () => {
    const models = await fetchModels('anthropic', '');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.includes('claude'))).toBe(true);
  });

  it('throws INVALID_KEY on 401 from OpenAI', async () => {
    await expect(fetchModels('openai', 'bad-key')).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
  });

  it('sorts Groq results alphabetically', async () => {
    const models = await fetchModels('groq', 'any-key');
    expect(models).toEqual([...models].sort());
  });

  it('filters Together AI to chat/language models only', async () => {
    const models = await fetchModels('together', 'any-key');
    expect(models).toContain('meta-llama/Llama-3');
    expect(models).not.toContain('stabilityai/sd-3');
  });

  it('returns empty array for custom provider', async () => {
    const models = await fetchModels('custom', 'any-key');
    expect(models).toEqual([]);
  });

  it('throws NETWORK with Ollama message when not running', async () => {
    server.use(
      http.get('http://localhost:11434/api/tags', () => new Response('Error', { status: 500 })),
    );
    await expect(fetchModels('ollama', '')).rejects.toMatchObject({
      code: 'NETWORK',
      message: expect.stringContaining('ollama serve'),
    });
  });

  it('returns static list for MiniMax', async () => {
    const models = await fetchModels('minimax', 'any-key');
    expect(models).toContain('MiniMax-M2.5');
  });
});
