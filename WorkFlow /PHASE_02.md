# Phase 2 — LLM integration: stream parser, API client, prompt engine

## What this phase builds

The complete LLM communication layer. After this phase you can call M2.5,
stream the response, parse `<think>` tags live, and extract a typed DrillResult.
Still no CLI entry point — tested directly in unit tests and a manual smoke test.

## Depends on

Phase 1 complete. `types.ts`, `redact.ts`, `chunk.ts` all tested and passing.

## Scope: what is built in this phase only

- `packages/cli/src/lib/stream.ts` — SSE parser with think-tag splitting
- `packages/cli/src/lib/api.ts` — HTTP client with fallback and retry
- `packages/cli/src/lib/prompts.ts` — system prompt, user prompt builder, result parser
- `packages/cli/test/stream.test.ts` — unit tests
- `packages/cli/test/api.test.ts` — unit tests with MSW mocks
- `packages/cli/test/prompts.test.ts` — prompt builder + result parser tests
- `.env.test` at project root — test environment variables

## What is NOT built in this phase

CLI commands, rendering, terminal output — Phase 3.
Auth, web API — Phase 6+.
In this phase the API key is read from `DRILL_API_KEY` env var directly.

---

## Environment for Phase 2 (local development only)

Create `packages/cli/.env.dev` (gitignored):
```
DRILL_API_KEY=your_minimax_key_here
DRILL_API_URL=https://api.minimax.io/v1
DRILL_FALLBACK_URL=https://api.together.xyz/v1
DRILL_FALLBACK_KEY=your_together_key_here
DRILL_MODEL=MiniMax-M2.5
DRILL_FALLBACK_MODEL=MiniMaxAI/MiniMax-M2.5
```

In Phase 2, `api.ts` reads these directly. In Phase 6, the CLI binary
will call the managed drill.dev API instead. The interface does not change —
only the URL and key change. This is deliberate: Phase 2 validates the
LLM integration directly before adding the API proxy layer.

---

## File: packages/cli/src/lib/prompts.ts

### System prompt constant

```typescript
export const SYSTEM_PROMPT = `You are Drill, an expert systems debugger specializing in production incident analysis.

Your job: analyze log output, error messages, and stack traces to identify the most probable root cause.

ANALYSIS METHODOLOGY:
1. Look for the FIRST failure, not downstream symptoms. A database connection error causing 100 API failures — the cause is the DB connection, not the API failures.
2. Check temporal patterns. Errors starting at a specific timestamp mean something changed at that time.
3. Look for resource exhaustion: connection pools, memory, disk, file descriptors, thread limits.
4. Identify the category: configuration error, code bug, infrastructure failure, or dependency failure.
5. Be specific. "Database connection failed" is worse than "PostgreSQL pool exhausted: max_connections=10 reached at 14:07:33".

CONFIDENCE SCORING:
- 90-100: Direct evidence (error message explicitly states the cause)
- 70-89: Strong circumstantial (timing correlation + clear error pattern)
- 50-69: Probable but needs verification (pattern match, no direct evidence)
- 30-49: Possible but speculative (limited data, multiple equally likely causes)
- 0-29: Insufficient data (logs too sparse or truncated)

SEVERITY SCORING:
- critical: Service completely down, data loss possible, security breach
- high: Major feature broken, significant user impact
- medium: Degraded performance, partial failure, workaround exists
- low: Minor issue, no user impact

OUTPUT RULES:
1. Respond ONLY with a valid JSON object matching the schema below. No markdown fences. No prose before or after.
2. Never invent log lines not present in the input.
3. If logs are insufficient, set confidence below 40 and explain in "missing".
4. "fix" must be specific and actionable — never generic.
5. "evidence" must contain actual quoted lines from the input.
6. Start your response with { and end with }. Nothing else.

RESPONSE SCHEMA:
{
  "cause": "one specific sentence identifying root cause",
  "confidence": 0-100,
  "severity": "critical" | "high" | "medium" | "low",
  "evidence": ["exact log line 1", "exact log line 2"],
  "fix": "specific actionable fix instruction",
  "alternative": "second hypothesis or null",
  "missing": "what additional logs would help or null"
}`;
```

### Input type detection

```typescript
type InputType = 'python-traceback' | 'oom-kill' | 'ci-build' | 'short' | 'general';

/**
 * Detects the type of log input to append type-specific hints to the prompt.
 * @param input Redacted log string
 * @returns Detected input type
 */
export function detectInputType(input: string): InputType {
  if (/Traceback \(most recent call last\)/i.test(input)) return 'python-traceback';
  if (/Out of memory:|OOM killer|Killed\s*$/im.test(input)) return 'oom-kill';
  if (/##\[error\]|FAILED.*tests ran|npm ERR! Test failed/i.test(input)) return 'ci-build';
  if (input.split('\n').length < 10) return 'short';
  return 'general';
}

const TYPE_HINTS: Record<InputType, string> = {
  'python-traceback': 'Note: This is a Python traceback. The root cause is in the last non-library frame before the exception.',
  'oom-kill': 'Note: This is an out-of-memory event. Focus on: container memory limit, memory growth pattern, and the process that was killed.',
  'ci-build': 'Note: This is a CI build/test log. Focus on the FIRST failure — ignore cascade failures after it.',
  'short': 'Note: This is a very short log snippet. The root cause may be in earlier logs not provided. Reflect this in confidence score.',
  'general': '',
};
```

### Prompt builder

```typescript
/**
 * Builds the user prompt message for M2.5.
 * @param input Redacted, chunked log string
 * @param context Optional codebase context string
 * @returns Formatted user message string
 */
export function buildUserPrompt(input: string, context?: string): string {
  const lineCount = input.split('\n').length;
  const inputType = detectInputType(input);
  const typeHint = TYPE_HINTS[inputType];

  const contextSection = context
    ? `\n=== CODEBASE CONTEXT ===\n${context}\n=== END CODEBASE CONTEXT ===\n`
    : '';

  const hintSection = typeHint ? `\n${typeHint}\n` : '';

  return [
    `Analyze the following and identify the root cause. (${lineCount} lines)`,
    '',
    '=== LOG INPUT ===',
    input,
    '=== END LOG INPUT ===',
    contextSection,
    hintSection,
    'Respond with the DrillResult JSON schema only.',
  ].filter(s => s !== undefined).join('\n');
}
```

### Result parser with retry prompt

```typescript
/**
 * Parses the raw LLM response string into a typed DrillResult.
 * Handles: JSON wrapped in markdown fences, leading/trailing prose,
 * partial JSON objects. Uses Zod for runtime validation.
 * @param raw Raw string from LLM (complete, not streaming)
 * @returns Validated DrillResult
 * @throws ParseError if JSON cannot be extracted or fails schema validation
 */
export function parseResult(raw: string): DrillResult {
  // Step 1: Strip markdown fences if present
  let cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Step 2: Extract JSON object (handles leading prose)
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ParseError(`No JSON object found. Raw response: ${cleaned.slice(0, 200)}`);
  }
  cleaned = jsonMatch[0];

  // Step 3: Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown parse error';
    throw new ParseError(`Invalid JSON: ${msg}. Content: ${cleaned.slice(0, 200)}`);
  }

  // Step 4: Validate with Zod
  const result = DrillResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`Schema validation failed: ${result.error.message}`);
  }

  return result.data;
}

// Zod schema for runtime DrillResult validation
export const DrillResultSchema = z.object({
  cause: z.string().min(10, 'Cause too short').max(500, 'Cause too long'),
  confidence: z.number().int().min(0).max(100),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  evidence: z.array(z.string()).min(0).max(10),
  fix: z.string().min(5, 'Fix too short').max(500, 'Fix too long'),
  alternative: z.string().nullable(),
  missing: z.string().nullable(),
});

// Prompt to append on parse failure (used by api.ts retry logic)
export const PARSE_RETRY_SUFFIX = `\n\nCRITICAL: Your previous response could not be parsed as JSON. You MUST respond with ONLY a raw JSON object. Start with { and end with }. No markdown. No explanation. Just the JSON object.`;

export class ParseError extends Error {
  readonly name = 'ParseError';
}
```

---

## File: packages/cli/src/lib/stream.ts

The SSE parser. Splits the M2.5 stream into two channels:
1. `<think>` content → `onThinking` callback (shown live in terminal)
2. Result content → buffered, parsed as JSON when stream ends

```typescript
import { createParser } from 'eventsource-parser';

export interface StreamHandlers {
  /** Called with each chunk of thinking text as it arrives */
  onThinking: (text: string) => void;
  /** Called with each chunk of non-thinking result text */
  onResultChunk: (text: string) => void;
  /** Called when stream ends with the complete result buffer */
  onDone: (completeResult: string) => void;
  /** Called on any stream error */
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
  let thinkBuffer = '';   // accumulates incomplete think tag across chunks
  let resultBuffer = '';  // accumulates non-think content

  const parser = createParser({
    onEvent(event) {
      if (event.data === '[DONE]') return;

      let parsed: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        parsed = JSON.parse(event.data) as typeof parsed;
      } catch {
        return; // skip malformed chunks
      }

      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (!delta) return;

      // Process delta character by character to handle tags split across chunks
      let i = 0;
      while (i < delta.length) {
        if (!inThink) {
          const thinkStart = delta.indexOf('<think>', i);
          if (thinkStart === -1) {
            // No think tag in remainder — all result content
            resultBuffer += delta.slice(i);
            handlers.onResultChunk(delta.slice(i));
            break;
          } else {
            // Result content before think tag
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
            // Rest of chunk is think content
            const thinkContent = delta.slice(i);
            thinkBuffer += thinkContent;
            handlers.onThinking(thinkContent);
            break;
          } else {
            // Think content up to closing tag
            const thinkContent = delta.slice(i, thinkEnd);
            if (thinkContent) {
              thinkBuffer += thinkContent;
              handlers.onThinking(thinkContent);
            }
            inThink = false;
            thinkBuffer = '';
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
```

---

## File: packages/cli/src/lib/api.ts

```typescript
import { buildUserPrompt, SYSTEM_PROMPT, PARSE_RETRY_SUFFIX, parseResult } from './prompts.ts';
import { parseStream } from './stream.ts';
import type { DrillResult, DrillError, StreamHandlers } from '../types.ts';

interface AnalyzeOptions {
  input: string;
  context?: string;
  onThinking?: (text: string) => void;
  onResultChunk?: (text: string) => void;
  timeoutMs?: number;
}

interface ApiConfig {
  primaryUrl: string;
  primaryKey: string;
  primaryModel: string;
  fallbackUrl: string;
  fallbackKey: string;
  fallbackModel: string;
}

/**
 * Loads API configuration from environment variables.
 * In Phase 2: reads from process.env directly (dev mode).
 * In Phase 6+: URLs point to drill.dev managed API.
 */
export function loadApiConfig(): ApiConfig {
  // Phase 2: direct M2.5 access via env vars
  // Phase 6+: this function is replaced to point at drill.dev/api/analyze
  return {
    primaryUrl: process.env['DRILL_API_URL'] ?? 'https://api.minimax.io/v1',
    primaryKey: process.env['DRILL_API_KEY'] ?? '',
    primaryModel: process.env['DRILL_MODEL'] ?? 'MiniMax-M2.5',
    fallbackUrl: process.env['DRILL_FALLBACK_URL'] ?? 'https://api.together.xyz/v1',
    fallbackKey: process.env['DRILL_FALLBACK_KEY'] ?? '',
    fallbackModel: process.env['DRILL_FALLBACK_MODEL'] ?? 'MiniMaxAI/MiniMax-M2.5',
  };
}

/**
 * Calls the LLM API to analyze log input. Handles streaming, provider
 * fallback, and up to 2 parse-retry attempts on JSON parse failure.
 *
 * @param options Analysis options including input and streaming callbacks
 * @returns DrillResult on success, DrillError on failure
 */
export async function analyze(
  options: AnalyzeOptions,
): Promise<DrillResult | DrillError> {
  const config = loadApiConfig();

  if (!config.primaryKey) {
    return {
      code: 'INVALID_KEY',
      message: 'No API key configured. Set DRILL_API_KEY environment variable.',
    } satisfies DrillError;
  }

  const handlers: StreamHandlers = {
    onThinking: options.onThinking ?? (() => undefined),
    onResultChunk: options.onResultChunk ?? (() => undefined),
    onDone: () => undefined,  // overridden below
    onError: () => undefined, // overridden below
  };

  // Attempt with up to 2 parse retries
  for (let attempt = 0; attempt <= 2; attempt++) {
    const isRetry = attempt > 0;
    const systemPrompt = isRetry
      ? SYSTEM_PROMPT + PARSE_RETRY_SUFFIX
      : SYSTEM_PROMPT;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: buildUserPrompt(options.input, options.context) },
    ];

    const result = await callProvider(
      attempt === 0 ? config : { ...config, primaryUrl: config.fallbackUrl, primaryKey: config.fallbackKey, primaryModel: config.fallbackModel },
      messages,
      handlers,
      options.timeoutMs ?? 90_000,
    );

    if (result.type === 'success') return result.data;
    if (result.type === 'parse_error' && attempt < 2) continue; // retry
    if (result.type === 'limit_reached') return result.error;
    if (result.type === 'auth_error') return result.error;

    // Final attempt failed
    return {
      code: 'PARSE_FAILED',
      message: `Failed to parse LLM response after ${attempt + 1} attempts: ${result.message}`,
    } satisfies DrillError;
  }

  // TypeScript exhaustiveness — should never reach here
  return { code: 'PARSE_FAILED', message: 'Unexpected error' } satisfies DrillError;
}

type CallResult =
  | { type: 'success'; data: DrillResult }
  | { type: 'parse_error'; message: string }
  | { type: 'limit_reached'; error: DrillError }
  | { type: 'auth_error'; error: DrillError }
  | { type: 'network_error'; message: string };

async function callProvider(
  config: ApiConfig,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  handlers: StreamHandlers,
  timeoutMs: number,
): Promise<CallResult> {
  let response: Response;

  try {
    response = await fetch(`${config.primaryUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.primaryKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.primaryModel,
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 40,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network error';
    return { type: 'network_error', message: msg };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      type: 'auth_error',
      error: { code: 'INVALID_KEY', message: 'API key rejected. Check DRILL_API_KEY.' },
    };
  }
  if (response.status === 429) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      type: 'limit_reached',
      error: {
        code: 'LIMIT_REACHED',
        message: 'Run limit reached.',
        upgrade_url: (body['upgrade'] as string | undefined) ?? 'https://drill.dev/upgrade',
      },
    };
  }
  if (!response.ok) {
    return { type: 'network_error', message: `HTTP ${response.status}` };
  }

  // Stream and collect result
  let resultText = '';
  let streamError: Error | null = null;

  await parseStream(response, {
    ...handlers,
    onDone: (complete) => { resultText = complete; },
    onError: (err) => { streamError = err; },
  });

  if (streamError) {
    return { type: 'network_error', message: streamError.message };
  }

  try {
    const parsed = parseResult(resultText);
    return { type: 'success', data: parsed };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Parse failed';
    return { type: 'parse_error', message: msg };
  }
}
```

---

## Test file: packages/cli/test/stream.test.ts

```typescript
import { describe, it, expect, vi } from 'vitest';
import { parseStream } from '../src/lib/stream';

// Helper: creates a mock Response with an SSE body from an array of chunks
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
      sseChunk('<thi'),
      sseChunk('nk>partial th'),
      sseChunk('inking</think>{"cause":"x"}'),
      'data: [DONE]\n\n',
    ]);
    await parseStream(response, {
      onThinking: (t) => thinking.push(t),
      onResultChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    });
    expect(thinking.join('')).toContain('partial th');
    expect(thinking.join('')).toContain('inking');
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
    expect(onError).not.toHaveBeenCalled(); // malformed chunks skipped, not errors
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
```

---

## Test file: packages/cli/test/prompts.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { buildUserPrompt, parseResult, detectInputType, SYSTEM_PROMPT } from '../src/lib/prompts';

describe('detectInputType', () => {
  it('detects python tracebacks', () => {
    expect(detectInputType('Traceback (most recent call last):\n  File')).toBe('python-traceback');
  });
  it('detects OOM events', () => {
    expect(detectInputType('Out of memory: Kill process 1234')).toBe('oom-kill');
  });
  it('detects CI build logs', () => {
    expect(detectInputType('##[error] Process failed\nFAILED 3 tests ran')).toBe('ci-build');
  });
  it('detects short inputs', () => {
    expect(detectInputType('just one error line')).toBe('short');
  });
  it('defaults to general', () => {
    expect(detectInputType('normal log line\nanother line\n'.repeat(20))).toBe('general');
  });
});

describe('buildUserPrompt', () => {
  it('includes line count', () => {
    const prompt = buildUserPrompt('line1\nline2\nline3');
    expect(prompt).toContain('3 lines');
  });
  it('includes the log input', () => {
    const prompt = buildUserPrompt('ERROR: connection refused');
    expect(prompt).toContain('ERROR: connection refused');
  });
  it('includes context section when provided', () => {
    const prompt = buildUserPrompt('error log', 'function main() {}');
    expect(prompt).toContain('CODEBASE CONTEXT');
    expect(prompt).toContain('function main()');
  });
  it('omits context section when not provided', () => {
    const prompt = buildUserPrompt('error log');
    expect(prompt).not.toContain('CODEBASE CONTEXT');
  });
  it('appends python traceback hint for python logs', () => {
    const prompt = buildUserPrompt('Traceback (most recent call last):\n  File "app.py"');
    expect(prompt).toContain('Python traceback');
  });
});

describe('parseResult', () => {
  const validResult = {
    cause: 'Database connection pool exhausted',
    confidence: 87,
    severity: 'high',
    evidence: ['Too many connections at 14:07'],
    fix: 'Increase DB_POOL_SIZE to 25',
    alternative: null,
    missing: null,
  };

  it('parses valid JSON', () => {
    const result = parseResult(JSON.stringify(validResult));
    expect(result.cause).toBe('Database connection pool exhausted');
    expect(result.confidence).toBe(87);
  });

  it('strips markdown fences', () => {
    const result = parseResult('```json\n' + JSON.stringify(validResult) + '\n```');
    expect(result.confidence).toBe(87);
  });

  it('extracts JSON from surrounding prose', () => {
    const result = parseResult('Here is my analysis:\n' + JSON.stringify(validResult) + '\nThat is the cause.');
    expect(result.cause).toBe('Database connection pool exhausted');
  });

  it('throws ParseError for invalid JSON', () => {
    expect(() => parseResult('not json at all')).toThrow('ParseError');
  });

  it('throws ParseError for JSON failing schema validation', () => {
    expect(() => parseResult('{"cause": "x"}')).toThrow(); // missing required fields
  });

  it('validates severity enum', () => {
    const invalid = { ...validResult, severity: 'extreme' };
    expect(() => parseResult(JSON.stringify(invalid))).toThrow();
  });

  it('validates confidence range', () => {
    const invalid = { ...validResult, confidence: 150 };
    expect(() => parseResult(JSON.stringify(invalid))).toThrow();
  });
});

describe('SYSTEM_PROMPT', () => {
  it('contains confidence scoring rules', () => {
    expect(SYSTEM_PROMPT).toContain('90-100');
    expect(SYSTEM_PROMPT).toContain('Direct evidence');
  });
  it('contains schema definition', () => {
    expect(SYSTEM_PROMPT).toContain('"cause"');
    expect(SYSTEM_PROMPT).toContain('"confidence"');
    expect(SYSTEM_PROMPT).toContain('"severity"');
  });
  it('instructs JSON-only output', () => {
    expect(SYSTEM_PROMPT).toContain('Start your response with {');
  });
});
```

---

## Manual smoke test — run this before moving to Phase 3

Create `packages/cli/test/manual-smoke.ts` (not committed — local testing only):

```typescript
// tsx packages/cli/test/manual-smoke.ts
import { analyze } from '../src/lib/api.ts';

const testLog = `
2024-01-15 14:07:33 ERROR: remaining connection slots are reserved for non-replication superuser connections
2024-01-15 14:07:33 ERROR: connection to server at "db.prod.internal" (10.0.0.5), port 5432 failed: FATAL: remaining connection slots are reserved
2024-01-15 14:07:33 ERROR: [UserService] Failed to fetch user profile: Connection refused
2024-01-15 14:07:33 ERROR: [OrderService] Failed to create order: Connection refused
2024-01-15 14:07:33 ERROR: [AuthService] Failed to validate session: Connection refused
`;

console.log('Calling M2.5 directly...\n');

const result = await analyze({
  input: testLog,
  onThinking: (text) => process.stdout.write(`\x1b[2m${text}\x1b[0m`),
  onResultChunk: () => undefined,
});

if ('code' in result) {
  console.error('Error:', result.message);
  process.exit(1);
}

console.log('\n\nResult:');
console.log(JSON.stringify(result, null, 2));
console.log('\nCause:', result.cause);
console.log('Confidence:', result.confidence + '%');
console.log('Severity:', result.severity);
console.log('Fix:', result.fix);
```

Run with: `DRILL_API_KEY=your_key tsx packages/cli/test/manual-smoke.ts`

Expected: M2.5 thinks aloud, then returns JSON identifying DB connection pool exhaustion as the cause with confidence >75%.

---

## Exit criteria — Phase 2 is complete when ALL pass

```bash
# 1. All tests pass
pnpm --filter cli test
# Expected: stream.test.ts (7), prompts.test.ts (14), plus Phase 1 tests still passing

# 2. TypeScript strict — zero errors
pnpm typecheck

# 3. Manual smoke test succeeds
DRILL_API_KEY=your_key tsx packages/cli/test/manual-smoke.ts
# Expected: thinking output streams, then valid JSON result with confidence > 50

# 4. Retry logic works — test with a bad key
DRILL_API_KEY=invalid tsx packages/cli/test/manual-smoke.ts
# Expected: DrillError { code: 'INVALID_KEY', message: '...' }

# 5. Parse retry prompt is correct
node -e "
const { PARSE_RETRY_SUFFIX } = require('./packages/cli/src/lib/prompts.ts');
" 2>&1 || tsx -e "
import { PARSE_RETRY_SUFFIX } from './packages/cli/src/lib/prompts.ts';
console.assert(PARSE_RETRY_SUFFIX.includes('CRITICAL'), 'retry suffix must contain CRITICAL');
console.log('PASS');
"
```
