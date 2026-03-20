# Phase 6 — Backend API: managed service layer

## What this phase builds

The managed API that sits between the CLI binary and M2.5.
After this phase the CLI no longer calls M2.5 directly — it calls
`drill.dev/api/analyze`, which handles auth, rate limiting, provider
fallback, and LLM proxying. The CLI binary's `api.ts` is updated to
point at this endpoint.

## Depends on

Phases 1–5 complete. Core CLI working. Vercel Pro account required
(60-second function timeout).

## Scope

- `packages/web/` — Next.js 15 App Router project scaffold
- `packages/web/app/api/analyze/route.ts` — the core route
- `packages/web/lib/llm.ts` — provider abstraction with fallback
- `packages/web/lib/prompts.ts` — shared with CLI (symlinked or copied)
- `packages/web/lib/env.ts` — Zod-validated server env
- `packages/web/lib/rate-limit.ts` — Upstash Redis rate limiting
- `packages/web/vercel.json` — 60s maxDuration config
- Updated `packages/cli/src/lib/api.ts` — switch from direct M2.5 to managed API
- Updated `packages/cli/src/lib/env.ts` — add managed API key support
- `packages/web/test/api/analyze.test.ts` — route unit tests

---

## packages/web scaffold

```bash
# Run in packages/web/
pnpm create next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbo
```

Then install required dependencies:
```bash
pnpm add @supabase/supabase-js zod @upstash/ratelimit @upstash/redis stripe @clerk/nextjs
pnpm add -D @types/node vitest @vitest/coverage-v8 msw
```

---

## File: packages/web/vercel.json

```json
{
  "functions": {
    "app/api/analyze/route.ts": {
      "maxDuration": 60
    },
    "app/api/cli-auth/poll/route.ts": {
      "maxDuration": 10
    }
  }
}
```

---

## File: packages/web/lib/env.ts

```typescript
import { z } from 'zod';

const ServerEnvSchema = z.object({
  // LLM providers
  MINIMAX_API_KEY: z.string().min(1, 'MINIMAX_API_KEY required'),
  TOGETHER_API_KEY: z.string().min(1, 'TOGETHER_API_KEY required'),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY required'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Clerk
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_TEAMS_PRICE_ID: z.string().min(1),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DRILL_ANON_KEY: z.string().min(20, 'DRILL_ANON_KEY must be at least 20 chars'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | null = null;

/**
 * Returns validated server environment variables.
 * Cached after first call. Throws on missing/invalid values.
 * Never call this from client-side code.
 */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) return cachedEnv;
  const result = ServerEnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Missing/invalid environment variables:\n${issues}`);
  }
  cachedEnv = result.data;
  return cachedEnv;
}
```

---

## File: packages/web/lib/rate-limit.ts

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let redis: Redis | null = null;
let anonLimiter: Ratelimit | null = null;
let keyLimiter: Ratelimit | null = null;

function getRedis(): Redis {
  if (!redis) redis = Redis.fromEnv();
  return redis;
}

/**
 * Rate limit for anonymous key: 3 requests per 24 hours per IP.
 * @param ip The client IP address
 * @returns true if over limit, false if allowed
 */
export async function checkAnonLimit(ip: string): Promise<boolean> {
  if (!anonLimiter) {
    anonLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(3, '24 h'),
      prefix: 'rl:anon',
    });
  }
  const { success } = await anonLimiter.limit(`ip:${ip}`);
  return !success;
}

/**
 * Secondary rate limit per API key: 1 request per 5 seconds.
 * Prevents abuse even by authenticated users.
 * @param apiKey The user's API key
 * @returns true if over limit, false if allowed
 */
export async function checkKeyThrottle(apiKey: string): Promise<boolean> {
  if (!keyLimiter) {
    keyLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(1, '5 s'),
      prefix: 'rl:key',
    });
  }
  const { success } = await keyLimiter.limit(`key:${apiKey.slice(-8)}`);
  return !success;
}
```

---

## File: packages/web/lib/llm.ts

```typescript
import type { ServerEnv } from './env.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMStreamResult {
  stream: ReadableStream<Uint8Array>;
  provider: 'minimax-primary' | 'together-fallback';
}

const LLM_PARAMS = {
  stream: true,
  temperature: 1.0,
  top_p: 0.95,
  top_k: 40,
} as const;

/**
 * Calls MiniMax M2.5 with streaming. Falls back to Together AI on
 * primary failure (5xx or timeout). Returns the raw SSE stream and
 * which provider was used.
 *
 * @param messages LLM message array
 * @param env Validated server environment
 * @returns Stream and provider info
 * @throws Error if both primary and fallback fail
 */
export async function callLLMStream(
  messages: ChatMessage[],
  env: ServerEnv,
): Promise<LLMStreamResult> {
  // Try primary
  const primaryResult = await tryProvider({
    url: 'https://api.minimax.io/v1/chat/completions',
    apiKey: env.MINIMAX_API_KEY,
    model: 'MiniMax-M2.5',
    messages,
    timeoutMs: 55_000,
  });

  if (primaryResult.ok && primaryResult.body) {
    return { stream: primaryResult.body, provider: 'minimax-primary' };
  }

  // Fallback to Together AI
  const fallbackResult = await tryProvider({
    url: 'https://api.together.xyz/v1/chat/completions',
    apiKey: env.TOGETHER_API_KEY,
    model: 'MiniMaxAI/MiniMax-M2.5',
    messages,
    timeoutMs: 55_000,
  });

  if (fallbackResult.ok && fallbackResult.body) {
    return { stream: fallbackResult.body, provider: 'together-fallback' };
  }

  throw new LLMError(
    `Both LLM providers failed. Primary: ${primaryResult.status}, Fallback: ${fallbackResult.status}`
  );
}

interface ProviderCallResult {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
}

async function tryProvider(opts: {
  url: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  timeoutMs: number;
}): Promise<ProviderCallResult> {
  try {
    const response = await fetch(opts.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        ...LLM_PARAMS,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: response.ok ? response.body : null,
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export class LLMError extends Error {
  readonly name = 'LLMError';
}
```

---

## File: packages/web/app/api/analyze/route.ts

Complete implementation per SPEC_API.md. Every edge case handled.

```typescript
import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';
import { callLLMStream } from '@/lib/llm';
import { checkAnonLimit, checkKeyThrottle } from '@/lib/rate-limit';
import { buildUserPrompt, SYSTEM_PROMPT } from '@/lib/prompts';
import type { ChatMessage } from '@/lib/llm';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface AnalyzeBody {
  input: string;
  apiKey: string;
  context?: string;
  version?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  const env = getServerEnv();

  // ── 1. Parse body ──────────────────────────────────────────────────────────
  let body: AnalyzeBody;
  try {
    body = await req.json() as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { input, apiKey, context } = body;

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return NextResponse.json({ error: 'input is required and must be non-empty' }, { status: 400 });
  }
  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }

  // ── 2. IP rate limit for anonymous key ────────────────────────────────────
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (apiKey === env.DRILL_ANON_KEY) {
    const limited = await checkAnonLimit(ip);
    if (limited) {
      return NextResponse.json(
        {
          error: 'Anonymous limit reached',
          code: 'ANON_LIMIT',
          upgrade: `${env.NEXT_PUBLIC_APP_URL}/signup`,
        },
        { status: 429 }
      );
    }
  }

  // ── 3. Per-key throttle ────────────────────────────────────────────────────
  const throttled = await checkKeyThrottle(apiKey);
  if (throttled) {
    return NextResponse.json(
      { error: 'Too many requests. Wait 5 seconds.', code: 'THROTTLED' },
      { status: 429, headers: { 'Retry-After': '5' } }
    );
  }

  // ── 4. Authenticate & check plan ──────────────────────────────────────────
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const { data: user, error: authError } = await supabase
    .from('users')
    .select('id, plan, run_count, run_limit')
    .eq('api_key', apiKey)
    .single();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Invalid API key', code: 'INVALID_KEY' },
      { status: 401 }
    );
  }

  if (user.run_count >= user.run_limit) {
    return NextResponse.json(
      {
        error: 'Monthly run limit reached',
        code: 'LIMIT_REACHED',
        plan: user.plan,
        limit: user.run_limit,
        used: user.run_count,
        upgrade: `${env.NEXT_PUBLIC_APP_URL}/upgrade`,
      },
      { status: 429 }
    );
  }

  // ── 5. Increment run count (non-blocking) ─────────────────────────────────
  void supabase
    .from('users')
    .update({ run_count: user.run_count + 1 })
    .eq('id', user.id)
    .then(({ error }) => {
      if (error) console.error('Failed to increment run_count:', error);
    });

  // ── 6. Build LLM messages ──────────────────────────────────────────────────
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input, context) },
  ];

  // ── 7. Call LLM with fallback ─────────────────────────────────────────────
  let llmResult: Awaited<ReturnType<typeof callLLMStream>>;
  try {
    llmResult = await callLLMStream(messages, env);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'LLM error';
    console.error('LLM call failed:', msg);
    return NextResponse.json(
      { error: 'LLM provider unavailable', code: 'LLM_ERROR' },
      { status: 503 }
    );
  }

  // ── 8. Stream SSE response back to CLI ───────────────────────────────────
  const remaining = Math.max(0, user.run_limit - user.run_count - 1);

  return new Response(llmResult.stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Drill-Provider': llmResult.provider,
      'X-Drill-Remaining': String(remaining),
      'X-Drill-Plan': user.plan,
    },
  });
}

// Health check
export async function GET(): Promise<Response> {
  return NextResponse.json({ status: 'ok', version: '1.0.0' });
}
```

---

## Updated: packages/cli/src/lib/api.ts

Add managed API mode. The `loadApiConfig()` function now checks whether
a `DRILL_API_KEY` starting with `drill_sk_` is set (managed) or an
LLM provider key (direct). Direct mode stays for Phase 2-5 testing.

```typescript
// In loadApiConfig(), replace the direct M2.5 URL with the managed API URL
// when DRILL_API_KEY starts with 'drill_sk_':

export function loadApiConfig(): ApiConfig {
  const apiKey = process.env['DRILL_API_KEY'] ?? '';
  const isManagedKey = apiKey.startsWith('drill_sk_');

  if (isManagedKey) {
    // Phase 6+: managed service
    return {
      primaryUrl: process.env['DRILL_API_URL'] ?? 'https://drill.dev',
      primaryKey: apiKey,
      primaryModel: '',  // model selected server-side
      fallbackUrl: '',   // fallback handled server-side
      fallbackKey: '',
      fallbackModel: '',
    };
  }

  // Phase 2-5 direct access / local testing
  return {
    primaryUrl: process.env['DRILL_API_URL'] ?? 'https://api.minimax.io/v1',
    primaryKey: apiKey,
    primaryModel: process.env['DRILL_MODEL'] ?? 'MiniMax-M2.5',
    fallbackUrl: process.env['DRILL_FALLBACK_URL'] ?? 'https://api.together.xyz/v1',
    fallbackKey: process.env['DRILL_FALLBACK_KEY'] ?? '',
    fallbackModel: process.env['DRILL_FALLBACK_MODEL'] ?? 'MiniMaxAI/MiniMax-M2.5',
  };
}

// Also update callProvider() to use /api/analyze endpoint
// when using managed key:
async function callProvider(...): Promise<CallResult> {
  const isManagedKey = config.primaryKey.startsWith('drill_sk_');
  const url = isManagedKey
    ? `${config.primaryUrl}/api/analyze`
    : `${config.primaryUrl}/chat/completions`;

  // For managed API: send { input, apiKey, context }
  // For direct API: send { model, messages, stream, temperature... }
  const body = isManagedKey
    ? JSON.stringify({ input: messages[1]?.content ?? '', apiKey: config.primaryKey })
    : JSON.stringify({ model: config.primaryModel, messages, stream: true, temperature: 1.0, top_p: 0.95, top_k: 40 });

  // ... rest of implementation
}
```

---

## Test: packages/web/test/api/analyze.test.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase, env, rate-limit, and LLM
vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    MINIMAX_API_KEY: 'test',
    TOGETHER_API_KEY: 'test',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_KEY: 'test',
    DRILL_ANON_KEY: 'anon_test_key_12345678901234',
    NEXT_PUBLIC_APP_URL: 'https://drill.dev',
  }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkAnonLimit: vi.fn().mockResolvedValue(false),
  checkKeyThrottle: vi.fn().mockResolvedValue(false),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'u1', plan: 'pro', run_count: 5, run_limit: 999999 },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

vi.mock('@/lib/llm', () => ({
  callLLMStream: vi.fn().mockResolvedValue({
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"cause\\":\\"test\\"}"}}]}\n\n'));
        c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        c.close();
      }
    }),
    provider: 'minimax-primary',
  }),
}));

// Import after mocks
const { POST } = await import('@/app/api/analyze/route');

function makeRequest(body: object, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analyze', () => {
  it('returns 400 if input is missing', async () => {
    const res = await POST(makeRequest({ apiKey: 'test' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 if apiKey is missing', async () => {
    const res = await POST(makeRequest({ input: 'log' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 401 if apiKey not found in database', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValueOnce({
      from: () => ({
        select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }) }) }),
        update: () => ({ eq: () => Promise.resolve({}) }),
      }),
    } as ReturnType<typeof createClient>);

    const res = await POST(makeRequest({ input: 'log', apiKey: 'bad_key' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 429 if run limit reached', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    vi.mocked(createClient).mockReturnValueOnce({
      from: () => ({
        select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: { id: 'u1', plan: 'free', run_count: 20, run_limit: 20 }, error: null }) }) }),
        update: () => ({ eq: () => Promise.resolve({}) }),
      }),
    } as ReturnType<typeof createClient>);

    const res = await POST(makeRequest({ input: 'log', apiKey: 'valid' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(429);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('LIMIT_REACHED');
  });

  it('returns streaming response on success', async () => {
    const res = await POST(makeRequest({ input: 'log error here', apiKey: 'drill_sk_test' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('X-Drill-Provider')).toBe('minimax-primary');
  });

  it('includes X-Drill-Remaining header', async () => {
    const res = await POST(makeRequest({ input: 'log', apiKey: 'drill_sk_test' }) as Parameters<typeof POST>[0]);
    const remaining = res.headers.get('X-Drill-Remaining');
    expect(remaining).toBeTruthy();
    expect(parseInt(remaining ?? '0', 10)).toBeGreaterThanOrEqual(0);
  });
});
```

---

## Exit criteria — Phase 6 is complete when ALL pass

```bash
# 1. Web package builds
pnpm --filter web build
# Expected: Next.js build succeeds with zero errors

# 2. API route tests pass
pnpm --filter web test
# Expected: analyze.test.ts all passing

# 3. TypeScript zero errors in web package
pnpm --filter web typecheck

# 4. Health check responds
pnpm --filter web dev &
sleep 5
curl http://localhost:3000/api/analyze
# Expected: {"status":"ok","version":"1.0.0"}

# 5. CLI using managed key calls drill.dev API
# (After deploying to Vercel and creating a test user in Supabase)
DRILL_API_KEY=drill_sk_test_key_here \
  echo "Error: connection refused" | node packages/cli/dist/index.js
# Expected: response from managed API (not direct M2.5)

# 6. Rate limiting works
# Hit the anon limit with 4 requests from same IP
for i in {1..4}; do
  curl -X POST http://localhost:3000/api/analyze \
    -H "Content-Type: application/json" \
    -d '{"input":"test","apiKey":"anon_test_key_12345678901234"}'
done
# Expected: 4th request returns 429

# 7. Deployed to Vercel
vercel deploy --prod
curl https://drill.dev/api/analyze
# Expected: {"status":"ok","version":"1.0.0"}
```
