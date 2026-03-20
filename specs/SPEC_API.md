# SPEC_API — packages/web/app/api

## The single critical rule

The `/api/analyze` route is the only backend logic that touches the LLM. It receives redacted log text from the CLI binary, authenticates the request, enforces rate limits, calls M2.5 with streaming, and proxies the SSE stream directly back to the CLI. No log content is written to the database at any point.

---

## Route: POST /api/analyze

**File**: `packages/web/app/api/analyze/route.ts`

```typescript
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateEnv } from '@/lib/env';
import { callLLMStream } from '@/lib/llm';
import { buildMessages } from '@/lib/prompts';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;  // Vercel Pro: 60s

export async function POST(req: NextRequest): Promise<Response> {
  const env = validateEnv();

  // 1. Parse body
  const body = await req.json().catch(() => null);
  if (!body || !body.input || !body.apiKey) {
    return Response.json({ error: 'Missing input or apiKey' }, { status: 400 });
  }

  const { input, apiKey, context, version } = body as {
    input: string;
    apiKey: string;
    context?: string;
    version: string;
  };

  // 2. Rate limit by IP (anonymous abuse prevention)
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const ipLimited = await rateLimit(ip, { maxRequests: 3, windowMs: 86_400_000 });  // 3/day anonymous
  if (ipLimited && apiKey === env.DRILL_ANON_KEY) {
    return Response.json(
      { error: 'limit_reached', code: 'ANON_LIMIT', upgrade: `${env.NEXT_PUBLIC_APP_URL}/signup` },
      { status: 429 }
    );
  }

  // 3. Authenticate API key
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  const { data: user, error: authError } = await supabase
    .from('users')
    .select('id, plan, run_count, run_limit, email')
    .eq('api_key', apiKey)
    .single();

  if (authError || !user) {
    return Response.json({ error: 'Invalid API key', code: 'INVALID_KEY' }, { status: 401 });
  }

  // 4. Enforce run limit
  if (user.run_count >= user.run_limit) {
    return Response.json(
      {
        error: 'Monthly run limit reached',
        code: 'LIMIT_REACHED',
        plan: user.plan,
        limit: user.run_limit,
        upgrade: `${env.NEXT_PUBLIC_APP_URL}/upgrade`,
      },
      { status: 429 }
    );
  }

  // 5. Increment run count (fire-and-forget, non-blocking)
  void supabase
    .from('users')
    .update({ run_count: user.run_count + 1 })
    .eq('id', user.id);

  // 6. Build LLM messages
  const messages = buildMessages(input, context);

  // 7. Call LLM with streaming + fallback
  const { stream, provider } = await callLLMStream(messages, env);

  // 8. Return SSE stream to client
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Drill-Provider': provider,
      'X-Drill-Remaining': String(user.run_limit - user.run_count - 1),
    },
  });
}
```

---

## lib/llm.ts — provider abstraction with fallback

```typescript
export async function callLLMStream(
  messages: ChatMessage[],
  env: Env
): Promise<{ stream: ReadableStream; provider: string }> {
  // Try primary (MiniMax official)
  try {
    const res = await fetch('https://api.minimax.io/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MINIMAX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 40,
        messages,
      }),
      signal: AbortSignal.timeout(55_000),  // 55s — under Vercel's 60s limit
    });

    if (!res.ok || !res.body) throw new Error(`Primary failed: ${res.status}`);
    return { stream: res.body, provider: 'minimax-primary' };

  } catch (primaryErr) {
    // Fallback to Together AI
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.TOGETHER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMaxAI/MiniMax-M2.5',
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 40,
        messages,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!res.ok || !res.body) {
      throw new LLMError('Both primary and fallback LLM providers failed');
    }
    return { stream: res.body, provider: 'together-fallback' };
  }
}
```

---

## Route: POST /api/auth/signup

Creates user account, generates API key, sends magic link via Clerk.

```typescript
// Body: { email: string }
// 1. Validate email format
// 2. Check if user already exists (return 409 if so)
// 3. Generate API key: `drill_sk_${crypto.randomBytes(24).toString('hex')}`
// 4. Insert user record into Supabase
// 5. Send magic link via Clerk
// 6. Return: { message: 'Check your email' }
```

---

## Route: GET /api/cli-auth/poll

Polling endpoint for `drill login` flow.

```typescript
// Query: ?state=<uuid>
// 1. Look up pending_auth_sessions table by state token
// 2. If not found or expired (>5min): return { status: 'expired' }
// 3. If pending: return { status: 'pending' }
// 4. If complete: return { status: 'complete', apiKey: string, plan: string, runLimit: number }
//    and delete the session record
```

---

## Route: POST /api/cli-auth/confirm

Called when user clicks magic link in browser during `drill login`.

```typescript
// Body: { state: string } (from URL param)
// 1. Verify user is authenticated via Clerk session
// 2. Look up state in pending_auth_sessions
// 3. Get user's API key from users table
// 4. Mark session as complete with apiKey
// 5. Redirect to /cli-auth/success page
```

---

## Route: POST /api/webhooks/stripe

Handles Stripe events to update user plan.

```typescript
// Events handled:
// checkout.session.completed → update plan + run_limit
// customer.subscription.deleted → downgrade to free
// customer.subscription.updated → update plan + run_limit

// Plan → run_limit mapping:
const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  pro: 999999,      // effectively unlimited
  teams: 999999,
  enterprise: 999999,
};
```

---

## Route: GET /api/admin/stats (protected — admin role only)

```typescript
// Returns:
{
  totalUsers: number,
  activeThisMonth: number,  // users with run_count > 0
  planDistribution: { free: n, pro: n, teams: n, enterprise: n },
  totalRunsToday: number,
  topUsers: Array<{ email: string, plan: string, run_count: number }>,
  mrr: number,  // calculated from Stripe
}
```

---

## lib/env.ts — validated environment (Zod)

```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  MINIMAX_API_KEY: z.string().min(1),
  TOGETHER_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  DRILL_ANON_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Missing environment variables: ${result.error.issues.map(i => i.path.join('.')).join(', ')}`);
  }
  return result.data;
}
```

---

## lib/rate-limit.ts — Upstash Redis rate limiting

```typescript
// Use @upstash/ratelimit + @upstash/redis
// Sliding window algorithm
// Keys: `rl:ip:{ip}` for anonymous, `rl:key:{apiKey}` for per-key secondary protection

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function rateLimit(
  key: string,
  options: { maxRequests: number; windowMs: number }
): Promise<boolean> {
  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(options.maxRequests, `${options.windowMs}ms`),
  });
  const { success } = await rl.limit(key);
  return !success;  // returns true if OVER limit
}
```

---

## Vercel configuration

**vercel.json**:
```json
{
  "functions": {
    "app/api/analyze/route.ts": {
      "maxDuration": 60
    }
  }
}
```

Note: 60-second maxDuration requires Vercel Pro plan minimum.
