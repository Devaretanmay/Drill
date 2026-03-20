import { describe, it, expect, vi } from 'vitest';
import { parseStream } from '../src/lib/stream';

function mockSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

describe('parseStream', () => {
  it('routes think content to onThinking', async () => {
    const thinking: string[] = [];
    const response = mockSseResponse([
      sseChunk('<think>analyzing the error</think>'),
      sseChunk('{"cause":"db issue"}'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: (t) => thinking.push(t),
      onResultChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });
    expect(thinking.join('')).toContain('analyzing the error');
  });

  it('routes result content to onResultChunk', async () => {
    const result: string[] = [];
    const response = mockSseResponse([
      sseChunk('<think>thinking</think>'),
      sseChunk('{"cause":"test"}'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: vi.fn(),
      onResultChunk: (r) => result.push(r),
      onDone: vi.fn(),
      onError: vi.fn(),
    });
    expect(result.join('')).toContain('{"cause":"test"}');
  });

  it('calls onDone with complete result buffer', async () => {
    let doneResult = '';
    const response = mockSseResponse([
      sseChunk('<think>x</think>'),
      sseChunk('{"cause":"a","confidence":80,"severity":"high","evidence":[],"fix":"fix it","alternative":null,"missing":null}'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: vi.fn(),
      onResultChunk: vi.fn(),
      onDone: (r) => { doneResult = r; },
      onError: vi.fn(),
    });
    expect(doneResult).toContain('"cause":"a"');
  });

  it('handles think tags split across chunks', async () => {
    const thinking: string[] = [];
    const response = mockSseResponse([
      sseChunk('some result '),
      sseChunk('<think>first half'),
      sseChunk('second half</think>'),
      sseChunk(' more result'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: (t) => thinking.push(t),
      onResultChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });
    expect(thinking.join('')).toContain('first half');
    expect(thinking.join('')).toContain('second half');
  });

  it('handles empty stream gracefully', async () => {
    const onDone = vi.fn();
    const onError = vi.fn();
    const response = mockSseResponse(['data: [DONE]\n\n']);
    await parseStream(response, {
      onThinking: vi.fn(),
      onResultChunk: vi.fn(),
      onDone,
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('');
  });

  it('handles malformed SSE chunks without throwing', async () => {
    const onError = vi.fn();
    const response = mockSseResponse([
      'data: not-valid-json\n\n',
      sseChunk('{"cause":"real"}'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: vi.fn(),
      onResultChunk: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when response body is null', async () => {
    const onError = vi.fn();
    const response = new Response(null);
    await parseStream(response, {
      onThinking: vi.fn(),
      onResultChunk: vi.fn(),
      onDone: vi.fn(),
      onError,
    });
    expect(onError).toHaveBeenCalled();
  });
});
