## 🚧 FUTURE SCOPE — Phase 7

# Phase 7 — Auth + database: Clerk, Supabase, CLI login flow

## What this phase builds

User accounts, authentication, and the `drill login` command.
After this phase users sign up at drill.dev, receive an API key,
and authenticate their CLI with `drill login`.

## Depends on

Phase 6 complete. drill.dev deployed on Vercel. Supabase project created.
Clerk app created. All environment variables set.

## Scope

- Supabase migrations (all 3 from SPEC_DATABASE.md)
- `packages/web/app/(auth)/sign-up/page.tsx` — sign-up page
- `packages/web/app/(auth)/sign-in/page.tsx` — sign-in page
- `packages/web/app/(auth)/cli-auth/page.tsx` — CLI browser auth
- `packages/web/app/(auth)/cli-auth/success/page.tsx`
- `packages/web/app/api/auth/signup/route.ts` — create user + generate API key
- `packages/web/app/api/cli-auth/poll/route.ts` — polling endpoint
- `packages/web/app/api/cli-auth/confirm/route.ts` — browser confirm
- `packages/web/middleware.ts` — Clerk auth protection
- Updated `packages/cli/src/commands/login.ts` — full implementation
- Updated `packages/cli/src/commands/logout.ts` — full implementation
- Updated `packages/cli/src/lib/auth.ts` — Conf-based token storage
- Updated `packages/cli/src/commands/status.ts` — show account info
- Updated `packages/cli/src/lib/env.ts` — read from ~/.drill/config

---

## Database setup

Run these migrations in Supabase SQL editor in order:

```bash
# Apply via Supabase CLI
supabase db push
# Or apply manually via dashboard SQL editor
# Files in packages/web/supabase/migrations/:
#   001_initial_schema.sql
#   002_monthly_reset_cron.sql
#   003_cleanup_sessions.sql
```

All SQL from SPEC_DATABASE.md must be applied exactly as written.
Verify RLS is enabled: every table must show "Row Level Security: Enabled"
in the Supabase dashboard.

---

## File: packages/web/lib/supabase.ts

```typescript
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export function createServerClient() {
  return createClient<Database>(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_KEY']!,
    { auth: { persistSession: false } }
  );
}

export function createBrowserClient() {
  return createClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!
  );
}
```

---

## File: packages/web/app/api/auth/signup/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { randomBytes } from 'node:crypto';

export async function POST(req: NextRequest): Promise<Response> {
  const { email, clerkId } = await req.json() as { email: string; clerkId: string };

  if (!email || !clerkId) {
    return NextResponse.json({ error: 'email and clerkId required' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Check if already exists
  const { data: existing } = await supabase
    .from('users')
    .select('id, api_key')
    .eq('clerk_id', clerkId)
    .single();

  if (existing) {
    return NextResponse.json({ apiKey: existing.api_key, existing: true });
  }

  // Create new user
  const apiKey = `drill_sk_${randomBytes(24).toString('hex')}`;

  const { data: user, error } = await supabase
    .from('users')
    .insert({
      email,
      clerk_id: clerkId,
      api_key: apiKey,
      plan: 'free',
      run_limit: 20,
    })
    .select('id, api_key')
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  return NextResponse.json({ apiKey: user.api_key, existing: false }, { status: 201 });
}
```

---

## File: packages/web/app/api/cli-auth/poll/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest): Promise<Response> {
  const state = req.nextUrl.searchParams.get('state');
  if (!state || !/^[0-9a-f-]{36}$/.test(state)) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: session } = await supabase
    .from('pending_auth_sessions')
    .select('status, api_key, plan, run_limit')
    .eq('state', state)
    .single();

  if (!session) {
    return NextResponse.json({ status: 'expired' });
  }
  if (session.status === 'complete') {
    return NextResponse.json({
      status: 'complete',
      apiKey: session.api_key,
      plan: session.plan,
      runLimit: session.run_limit,
    });
  }
  return NextResponse.json({ status: 'pending' });
}
```

---

## File: packages/web/app/api/cli-auth/confirm/route.ts

```typescript
// Called when user clicks confirm in browser after `drill login`
// Requires active Clerk session (user must be signed in)
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { state } = await req.json() as { state: string };

  const supabase = createServerClient();

  // Get user's API key
  const { data: user } = await supabase
    .from('users')
    .select('api_key, plan, run_limit')
    .eq('clerk_id', userId)
    .single();

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Mark session complete
  await supabase
    .from('pending_auth_sessions')
    .update({
      status: 'complete',
      user_id: userId,
      api_key: user.api_key,
      plan: user.plan,
      run_limit: user.run_limit,
    })
    .eq('state', state);

  return NextResponse.json({ success: true });
}
```

---

## File: packages/cli/src/lib/auth.ts

```typescript
import Conf from 'conf';
import type { DrillConfig } from '../types.ts';

const conf = new Conf<Partial<DrillConfig>>({
  projectName: 'drill',
  configName: 'config',
});

export function saveAuth(config: Partial<DrillConfig>): void {
  conf.set(config);
}

export function loadAuth(): Partial<DrillConfig> {
  return conf.store;
}

export function clearAuth(): void {
  conf.clear();
}

export function getApiKey(): string | undefined {
  return conf.get('apiKey') ?? process.env['DRILL_API_KEY'];
}

export function getApiUrl(): string {
  return conf.get('apiUrl') ?? process.env['DRILL_API_URL'] ?? 'https://drill.dev';
}

export function getConfigPath(): string {
  return conf.path;
}
```

---

## File: packages/cli/src/commands/login.ts (complete implementation)

```typescript
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import { saveAuth, getApiUrl } from '../lib/auth.ts';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function loginCommand(): Promise<void> {
  const state = randomUUID();
  const device = hostname();
  const apiUrl = getApiUrl();
  const authUrl = `${apiUrl}/cli-auth?state=${state}&device=${encodeURIComponent(device)}`;

  console.log(chalk.bold('\n  Opening browser to authorize Drill CLI...\n'));
  console.log(chalk.dim(`  URL: ${authUrl}\n`));

  await open(authUrl);

  const spinner = ora('Waiting for authorization...').start();
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const res = await fetch(`${apiUrl}/api/cli-auth/poll?state=${state}`);
      const data = await res.json() as {
        status: 'pending' | 'complete' | 'expired';
        apiKey?: string;
        plan?: string;
        runLimit?: number;
      };

      if (data.status === 'complete' && data.apiKey) {
        spinner.stop();
        saveAuth({
          apiKey: data.apiKey,
          apiUrl,
          plan: data.plan ?? 'free',
          runLimit: data.runLimit ?? 20,
          runCount: 0,
          redact: true,
          model: 'cloud',
        });
        console.log(chalk.green.bold('\n  Authorized!\n'));
        console.log(`  Plan: ${chalk.bold(data.plan ?? 'free')}`);
        console.log(`  Runs: ${chalk.bold(String(data.runLimit ?? 20))} per month\n`);
        console.log(chalk.dim('  Run `drill "your error message"` to get started.\n'));
        return;
      }

      if (data.status === 'expired') {
        spinner.fail('Authorization expired. Run `drill login` again.');
        process.exit(1);
      }
    } catch {
      // Network error during poll — continue waiting
    }
  }

  spinner.fail('Authorization timed out after 5 minutes.');
  process.exit(1);
}
```

---

## File: packages/cli/src/commands/logout.ts (complete)

```typescript
import chalk from 'chalk';
import { clearAuth, getConfigPath } from '../lib/auth.ts';

export async function logoutCommand(): Promise<void> {
  clearAuth();
  console.log(chalk.dim('\n  Logged out. API key removed from local config.'));
  console.log(chalk.dim(`  Config file: ${getConfigPath()}\n`));
}
```

---

## Updated: packages/cli/src/commands/status.ts

```typescript
import chalk from 'chalk';
import { loadAuth, getConfigPath } from '../lib/auth.ts';

export async function statusCommand(): Promise<void> {
  const config = loadAuth();

  console.log('\n' + chalk.bold('  Drill status'));
  console.log(chalk.dim('  ─────────────────────────────'));

  if (config.apiKey) {
    const keyDisplay = `${config.apiKey.slice(0, 12)}...${config.apiKey.slice(-4)}`;
    console.log(`  Status:    ${chalk.green('Authenticated')}`);
    console.log(`  Plan:      ${chalk.bold(config.plan ?? 'free')}`);
    console.log(`  API key:   ${chalk.dim(keyDisplay)}`);
    if (config.runCount !== undefined && config.runLimit !== undefined) {
      const pct = Math.round((config.runCount / config.runLimit) * 100);
      const color = pct > 80 ? chalk.red : pct > 50 ? chalk.yellow : chalk.green;
      console.log(`  Usage:     ${color(`${config.runCount}/${config.runLimit} runs this month`)}`);
    }
  } else {
    console.log(`  Status:    ${chalk.yellow('Not authenticated')}`);
    console.log(chalk.dim('\n  Run `drill login` to connect your account.'));
    console.log(chalk.dim('  Or set DRILL_API_KEY environment variable.\n'));
  }

  console.log(chalk.dim(`\n  Config:    ${getConfigPath()}\n`));
}
```

---

## Updated: packages/web/middleware.ts

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)', '/admin(.*)']);
const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth();
    const isAdmin = (sessionClaims?.metadata as { isAdmin?: boolean } | null)?.isAdmin;
    if (!isAdmin) {
      return NextResponse.redirect(new URL('/dashboard', req.url));
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)', '/(api|trpc)(.*)'],
};
```

---

## Exit criteria — Phase 7 complete

```bash
# 1. Migrations applied successfully
supabase db push
# Expected: 3 migrations applied, no errors

# 2. drill login flow works end-to-end
DRILL_API_URL=https://drill.dev node packages/cli/dist/index.js login
# Expected: browser opens, user signs in, CLI shows "Authorized!"

# 3. drill status shows account info after login
node packages/cli/dist/index.js status
# Expected: plan, key (masked), usage shown

# 4. drill logout clears token
node packages/cli/dist/index.js logout
node packages/cli/dist/index.js status
# Expected: "Not authenticated"

# 5. CLI with drill_sk_ key routes to managed API
node packages/cli/dist/index.js login
echo "Error: connection refused" | node packages/cli/dist/index.js
# Expected: response comes from drill.dev API (check X-Drill-Provider header with --verbose)
```

---
---

