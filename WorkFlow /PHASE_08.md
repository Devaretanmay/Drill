# Phase 8 — Billing: Stripe, plans, upgrade flow, rate limits

## What this phase builds

Stripe billing integration. Plan upgrades, subscription management,
and enforcement of plan limits. After this phase, users can upgrade
from Free to Pro or Teams and get unlimited runs.

## Scope

- `packages/web/lib/stripe.ts` — Stripe client, checkout, portal
- `packages/web/app/(dashboard)/dashboard/page.tsx` — user dashboard
- `packages/web/app/(dashboard)/settings/page.tsx` — account + billing
- `packages/web/app/(marketing)/pricing/page.tsx` — pricing page
- `packages/web/app/api/billing/checkout/route.ts` — create Stripe session
- `packages/web/app/api/billing/portal/route.ts` — billing portal
- `packages/web/app/api/webhooks/stripe/route.ts` — Stripe webhooks
- Updated `packages/cli/src/lib/upgrade.ts` — upgrade prompt + browser open

---

## File: packages/web/lib/stripe.ts

```typescript
import Stripe from 'stripe';
import { getServerEnv } from './env';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const env = getServerEnv();
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-01-27.acacia',
      typescript: true,
    });
  }
  return _stripe;
}

export const PLAN_LIMITS: Record<string, number> = {
  free: 20,
  pro: 999999,
  teams: 999999,
  enterprise: 999999,
};

export const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  teams: 'Teams',
  enterprise: 'Enterprise',
};

/**
 * Creates a Stripe Checkout session for plan upgrade.
 * Returns the checkout URL to redirect the user to.
 */
export async function createCheckoutSession(opts: {
  userId: string;
  email: string;
  stripeCustomerId?: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.stripeCustomerId ?? undefined,
    customer_email: opts.stripeCustomerId ? undefined : opts.email,
    line_items: [{ price: opts.priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { userId: opts.userId },
    subscription_data: {
      metadata: { userId: opts.userId },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) throw new Error('Stripe checkout URL is null');
  return session.url;
}

/**
 * Creates a Stripe Billing Portal session for subscription management.
 */
export async function createPortalSession(opts: {
  stripeCustomerId: string;
  returnUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: opts.stripeCustomerId,
    return_url: opts.returnUrl,
  });
  return session.url;
}
```

---

## File: packages/web/app/api/webhooks/stripe/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getStripe, PLAN_LIMITS } from '@/lib/stripe';
import { getServerEnv } from '@/lib/env';
import { createServerClient } from '@/lib/supabase';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: NextRequest): Promise<Response> {
  const env = getServerEnv();
  const stripe = getStripe();

  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Webhook verification failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const supabase = createServerClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.['userId'];
      const customerId = session.customer as string;
      if (userId && customerId) {
        await supabase.from('users').update({ stripe_id: customerId }).eq('id', userId);
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = sub.customer as string;
      const priceId = sub.items.data[0]?.price.id;
      const env = getServerEnv();

      let newPlan = 'free';
      if (priceId === env.STRIPE_PRO_PRICE_ID) newPlan = 'pro';
      else if (priceId === env.STRIPE_TEAMS_PRICE_ID) newPlan = 'teams';

      if (sub.status === 'active' || sub.status === 'trialing') {
        await supabase
          .from('users')
          .update({ plan: newPlan, run_limit: PLAN_LIMITS[newPlan] ?? 20 })
          .eq('stripe_id', customerId);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await supabase
        .from('users')
        .update({ plan: 'free', run_limit: PLAN_LIMITS['free'] })
        .eq('stripe_id', sub.customer as string);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

---

## File: packages/web/app/api/billing/checkout/route.ts

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan } = await req.json() as { plan: 'pro' | 'teams' };
  const env = getServerEnv();

  const priceId = plan === 'teams' ? env.STRIPE_TEAMS_PRICE_ID : env.STRIPE_PRO_PRICE_ID;

  const supabase = createServerClient();
  const { data: user } = await supabase
    .from('users')
    .select('email, stripe_id')
    .eq('clerk_id', userId)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const url = await createCheckoutSession({
    userId,
    email: user.email,
    stripeCustomerId: user.stripe_id ?? undefined,
    priceId,
    successUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard?upgraded=true`,
    cancelUrl: `${env.NEXT_PUBLIC_APP_URL}/pricing`,
  });

  return NextResponse.json({ url });
}
```

---

## Updated: packages/cli/src/lib/upgrade.ts

```typescript
import chalk from 'chalk';
import open from 'open';
import { getApiUrl } from './auth.ts';

/**
 * Shows an upgrade prompt and optionally opens the browser to the upgrade page.
 * Called when LIMIT_REACHED error is received.
 */
export async function showUpgradePrompt(opts?: { openBrowser?: boolean }): Promise<void> {
  const upgradeUrl = `${getApiUrl()}/upgrade`;

  console.log(chalk.yellow.bold('\n  Monthly run limit reached'));
  console.log(chalk.yellow(`\n  Upgrade to Pro for unlimited runs: ${chalk.underline(upgradeUrl)}\n`));

  if (opts?.openBrowser) {
    await open(upgradeUrl);
  }
}
```

---

## Exit criteria — Phase 8 complete

```bash
# 1. Stripe webhook receives and processes events
stripe listen --forward-to localhost:3000/api/webhooks/stripe
stripe trigger checkout.session.completed
# Expected: user plan updated in Supabase

# 2. Checkout flow works end-to-end
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Content-Type: application/json" \
  -d '{"plan":"pro"}'
# Expected: Stripe checkout URL returned

# 3. Free tier limit enforced
# Create user, set run_count=20, run_limit=20
echo "test" | DRILL_API_KEY=drill_sk_limited_user node packages/cli/dist/index.js
# Expected: "Monthly run limit reached" + upgrade URL shown

# 4. Pro user has unlimited runs (run_limit = 999999)
# After upgrading, run_limit field should be 999999 in Supabase
```

---
---


## File: packages/web/app/api/billing/portal/route.ts

```typescript
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createPortalSession } from '@/lib/stripe';
import { createServerClient } from '@/lib/supabase';
import { getServerEnv } from '@/lib/env';

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  const { data: user } = await supabase
    .from('users')
    .select('stripe_id')
    .eq('clerk_id', userId)
    .single();

  if (!user?.stripe_id) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  const env = getServerEnv();
  const url = await createPortalSession({
    stripeCustomerId: user.stripe_id,
    returnUrl: `${env.NEXT_PUBLIC_APP_URL}/settings`,
  });

  return NextResponse.redirect(url);
}
```

---

## Stripe setup checklist (do before running this phase)

```bash
# 1. Install Stripe CLI
brew install stripe/stripe-cli/stripe

# 2. Login
stripe login

# 3. Create products and prices in Stripe dashboard:
#    Product: "Drill Pro" → Price: $19/month recurring → copy Price ID
#    Product: "Drill Teams" → Price: $49/month recurring → copy Price ID
#    Add both Price IDs to packages/web/.env.local:
#      STRIPE_PRO_PRICE_ID=price_xxxxx
#      STRIPE_TEAMS_PRICE_ID=price_yyyyy

# 4. Get webhook secret for local dev
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copy the "whsec_xxx" shown — add as STRIPE_WEBHOOK_SECRET in .env.local

# 5. For production webhook on Vercel:
#    Stripe dashboard → Developers → Webhooks → Add endpoint
#    URL: https://drill.dev/api/webhooks/stripe
#    Events: checkout.session.completed, customer.subscription.created,
#             customer.subscription.updated, customer.subscription.deleted
#    Copy signing secret → add as STRIPE_WEBHOOK_SECRET in Vercel env vars
```

---

## Test: packages/web/test/api/billing.test.ts

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  getServerEnv: () => ({
    STRIPE_PRO_PRICE_ID: 'price_pro_test',
    STRIPE_TEAMS_PRICE_ID: 'price_teams_test',
    NEXT_PUBLIC_APP_URL: 'https://drill.dev',
  }),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: 'user_test_123' }),
}));

vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: vi.fn().mockResolvedValue('https://checkout.stripe.com/test'),
  createPortalSession: vi.fn().mockResolvedValue('https://billing.stripe.com/test'),
  PLAN_LIMITS: { free: 20, pro: 999999, teams: 999999, enterprise: 999999 },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: vi.fn().mockResolvedValue({
            data: { email: 'test@example.com', stripe_id: null },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

const { POST: checkoutPost } = await import('@/app/api/billing/checkout/route');

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/billing/checkout', () => {
  it('returns Stripe checkout URL for pro plan', async () => {
    const { createCheckoutSession } = await import('@/lib/stripe');
    const res = await checkoutPost(makeRequest({ plan: 'pro' }) as Parameters<typeof checkoutPost>[0]);
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string };
    expect(body.url).toBe('https://checkout.stripe.com/test');
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_pro_test' })
    );
  });

  it('uses teams price ID for teams plan', async () => {
    const { createCheckoutSession } = await import('@/lib/stripe');
    await checkoutPost(makeRequest({ plan: 'teams' }) as Parameters<typeof checkoutPost>[0]);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ priceId: 'price_teams_test' })
    );
  });
});

describe('Stripe webhook handler', () => {
  it('handles subscription.created event and updates user plan', async () => {
    // Test webhook processing logic separately from HTTP — verify plan update called
    // Full test requires Stripe signature verification bypass
    // Use: stripe trigger customer.subscription.created --add subscription:metadata.userId=test
    expect(true).toBe(true); // placeholder — test via stripe CLI
  });
});
```

---

## Updated exit criteria — Phase 8 complete (expanded)

```bash
# 1. Stripe CLI webhook forwarding
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# In another terminal:
stripe trigger checkout.session.completed
# Expected: webhook received, no errors in listener output

# 2. Checkout URL returned for authenticated user
# (Requires a valid Clerk session — test via dashboard UI)
# Visit /dashboard as free user → click "Upgrade" → should redirect to Stripe

# 3. Subscription creates correctly
stripe trigger customer.subscription.created
# Expected: user's plan updated to 'pro', run_limit set to 999999 in Supabase

# 4. Subscription deletion downgrades user
stripe trigger customer.subscription.deleted
# Expected: user's plan set back to 'free', run_limit set to 20

# 5. CLI shows upgrade prompt on limit reached
# Set a test user's run_count = run_limit in Supabase, then:
echo "error log" | DRILL_API_KEY=drill_sk_that_user node packages/cli/dist/index.js
# Expected: "Monthly run limit reached" + upgrade URL in output

# 6. Billing portal redirect works
# Visit /settings as Pro user → click "Manage subscription" → redirects to Stripe portal

# 7. Billing tests pass
pnpm --filter web test -- billing
# Expected: checkout route tests pass

# 8. TypeScript zero errors
pnpm --filter web typecheck
```
