# SPEC_DATABASE — Supabase Postgres

## Non-negotiables

- Row Level Security (RLS) enabled on every table
- No log content, error messages, or stack traces stored — ever
- All migrations in `packages/web/supabase/migrations/` as numbered SQL files
- Service key used server-side only (never in client-side code)
- Anon key used for client-side auth helpers only

---

## Migration 001 — core schema

```sql
-- 001_initial_schema.sql

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ─── users ────────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  clerk_id        TEXT UNIQUE,              -- Clerk user ID
  plan            TEXT NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free', 'pro', 'teams', 'enterprise')),
  stripe_id       TEXT,                     -- Stripe customer ID
  api_key         TEXT UNIQUE NOT NULL,     -- drill_sk_xxx
  run_count       INTEGER NOT NULL DEFAULT 0,
  run_limit       INTEGER NOT NULL DEFAULT 20,
  last_reset      DATE NOT NULL DEFAULT CURRENT_DATE,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for API key lookups (hot path — every request)
CREATE UNIQUE INDEX idx_users_api_key ON public.users (api_key);
CREATE INDEX idx_users_clerk_id ON public.users (clerk_id) WHERE clerk_id IS NOT NULL;
CREATE INDEX idx_users_stripe_id ON public.users (stripe_id) WHERE stripe_id IS NOT NULL;

-- RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by API routes)
CREATE POLICY "service_role_all" ON public.users
  FOR ALL USING (auth.role() = 'service_role');

-- Users can read their own record only
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT USING (clerk_id = auth.uid()::text);

-- ─── pending_auth_sessions ────────────────────────────────────────────────
-- Temporary records for CLI login flow
CREATE TABLE public.pending_auth_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state      TEXT UNIQUE NOT NULL,     -- random UUID from CLI
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE,
  api_key    TEXT,                     -- filled on confirm
  plan       TEXT,
  run_limit  INTEGER,
  device     TEXT,                     -- hostname from CLI
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'complete', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 minutes'
);

CREATE INDEX idx_pending_auth_state ON public.pending_auth_sessions (state);

ALTER TABLE public.pending_auth_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.pending_auth_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- ─── plan_events ──────────────────────────────────────────────────────────
-- Audit trail for plan changes and billing events
CREATE TABLE public.plan_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,  -- 'upgraded' | 'downgraded' | 'limit_hit' | 'reset' | 'signup'
  plan_from   TEXT,
  plan_to     TEXT,
  metadata    JSONB DEFAULT '{}',  -- stripe event ID, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_events_user_id ON public.plan_events (user_id);
CREATE INDEX idx_plan_events_created_at ON public.plan_events (created_at);

ALTER TABLE public.plan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.plan_events
  FOR ALL USING (auth.role() = 'service_role');

-- ─── updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## Migration 002 — monthly reset cron

```sql
-- 002_monthly_reset_cron.sql

-- Reset run_count for all users on 1st of each month at 00:00 UTC
SELECT cron.schedule(
  'monthly-run-count-reset',
  '0 0 1 * *',
  $$
    WITH reset_users AS (
      UPDATE public.users
      SET run_count = 0, last_reset = CURRENT_DATE
      WHERE last_reset < date_trunc('month', CURRENT_DATE)
      RETURNING id
    )
    INSERT INTO public.plan_events (user_id, event, metadata)
    SELECT id, 'reset', '{"source": "monthly_cron"}'::jsonb
    FROM reset_users;
  $$
);
```

---

## Migration 003 — cleanup expired sessions cron

```sql
-- 003_cleanup_sessions.sql

-- Delete expired pending_auth_sessions every 15 minutes
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '*/15 * * * *',
  $$
    DELETE FROM public.pending_auth_sessions
    WHERE expires_at < now() OR status = 'complete';
  $$
);
```

---

## Supabase client helpers — packages/web/lib/supabase.ts

```typescript
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';  // generated by supabase gen types

// Server-side client (API routes) — full access via service key
export function createServerClient() {
  return createSupabaseClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Client-side client — anon key, RLS enforced
export function createBrowserClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

---

## Type generation

Run after any schema change:
```bash
pnpm supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > packages/web/lib/database.types.ts
```

This generates full TypeScript types for all tables. Always use `Database` generic with Supabase client — never `any`.

---

## Key queries used in API routes

```typescript
// Auth check (hot path — every /api/analyze request)
const { data: user } = await supabase
  .from('users')
  .select('id, plan, run_count, run_limit')
  .eq('api_key', apiKey)
  .single();

// Increment run_count
await supabase
  .from('users')
  .update({ run_count: user.run_count + 1 })
  .eq('id', user.id);

// Create user on signup
await supabase
  .from('users')
  .insert({
    email,
    clerk_id: clerkUserId,
    api_key: `drill_sk_${crypto.randomBytes(24).toString('hex')}`,
    plan: 'free',
    run_limit: 20,
  });

// Update plan after Stripe webhook
await supabase
  .from('users')
  .update({ plan: newPlan, run_limit: PLAN_LIMITS[newPlan] })
  .eq('stripe_id', stripeCustomerId);
```
