/**
 * SSE Stream Parser Module
 * 
 * Parses Server-Sent Events stream from the LLM API, splitting think-tag content
 * from result content and routing each to the appropriate callback.
 */

import { createParser } from 'eventsource-parser';

export interface StreamHandlers {
  onThinking: (text: string) => void;
  onResultChunk: (text: string) => void;
  onDone: (completeResult: string) => void;
  onError: (err: Error) => void;
}

/**
 * Parses an SSE stream from the LLM API, splitting think-tag content
 * from result content and routing each to the appropriate callback.
 *
 * Handles:
 * - <think>...</think> tags split across multiple chunks
 * - [DONE] sentinel at end of stream
 * - Malformed or empty SSE chunks
 * - Connection drops mid-stream
 *
 * @param response The fetch() Response object with streaming body
 * @param handlers Callbacks for different stream event types
 */
export async function parseStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<void> {
  if (!response.body) {
    handlers.onError(new Error('Response body is null'));
    return;
  }

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
            handlers.onResultChunk(delta.slice(i));
            break;
          } else {
            const beforeThink = delta.slice(i, thinkStart);
            if (beforeThink) {
              resultBuffer += beforeThink;
              handlers.onResultChunk(beforeThink);
            }
            inThink = true;
            i = thinkStart + '<think>'.length;
          }
        } else {
          const thinkEnd = delta.indexOf('</think>', i);
          if (thinkEnd === -1) {
            const thinkContent = delta.slice(i);
            handlers.onThinking(thinkContent);
            break;
          } else {
            const thinkContent = delta.slice(i, thinkEnd);
            if (thinkContent) {
              handlers.onThinking(thinkContent);
            }
            inThink = false;
            i = thinkEnd + '</think>'.length;
          }
        }
      }
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
    }
    handlers.onDone(resultBuffer.trim());
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error('Stream read failed');
    handlers.onError(err);
  } finally {
    reader.releaseLock();
  }
}
