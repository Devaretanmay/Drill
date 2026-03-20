# SPEC_WEB — packages/web

## Stack

Next.js 15 App Router, TypeScript strict, Tailwind CSS v4, Clerk auth, Stripe billing, Supabase.

## Complete page/route map

```
app/
  (marketing)/
    page.tsx              # Homepage — hero, install, demo GIF, pricing, testimonials
    pricing/page.tsx      # Detailed pricing page
    docs/
      page.tsx            # Docs index
      cli/page.tsx        # Full CLI reference
      sdk/page.tsx        # SDK docs
      action/page.tsx     # GitHub Action docs
      self-host/page.tsx  # Self-host / --local mode docs
    changelog/page.tsx    # Version history
    privacy/page.tsx      # Privacy policy
    terms/page.tsx        # Terms of service
  (auth)/
    sign-in/page.tsx      # Clerk sign-in
    sign-up/page.tsx      # Clerk sign-up
    cli-auth/
      page.tsx            # Browser side of `drill login` — shows "Authorizing CLI..."
      success/page.tsx    # "CLI authorized successfully" confirmation
  (dashboard)/
    dashboard/
      page.tsx            # User dashboard: run count, plan badge, API key, upgrade CTA
      settings/page.tsx   # Account settings: email, plan, billing portal link
  (admin)/
    admin/
      page.tsx            # Admin overview: user stats, MRR, run counts
      users/page.tsx      # User table with search and plan filter
  api/
    analyze/route.ts      # POST — core LLM endpoint (see SPEC_API.md)
    auth/signup/route.ts
    cli-auth/poll/route.ts
    cli-auth/confirm/route.ts
    webhooks/stripe/route.ts
    admin/stats/route.ts
```

---

## Homepage design spec (app/(marketing)/page.tsx)

### Hero section
- H1: "Your logs know why. Drill finds it."
- Subheading: "Pipe any log stream into Drill and get a plain-English root cause in under 60 seconds. No setup. No dashboard. No agents."
- Primary CTA button: "Install free" → scrolls to install section
- Secondary CTA: "See it work" → plays demo video / GIF in modal
- Background: dark (#0F0A1E), text white — code-editor aesthetic

### Terminal demo section
- Animated terminal window showing real usage:
  ```
  $ docker logs my-api 2>&1 | drill
  ▸ reading 847 lines...
  ▸ thinking: examining connection pool exhaustion...
  ▸ checking temporal correlation with recent deploys...

  ┌─ DRILL ────────────────────── Confidence: 87% ─┐
  │ Cause:    DB connection pool exhausted (max 10) │
  │ Severity: HIGH                                  │
  │ Fix:      Set DB_POOL_SIZE=25 in your .env      │
  │ Evidence: "Too many connections" at 14:07:33    │
  └─────────────────────────────────────────────────┘
  ```
- Animation: typewriter effect, then result slides in
- Built with pure CSS animation — no heavy libraries

### Install section
Three tabs: npm | brew | curl
```bash
# npm
npm install -g drill-cli

# brew
brew install drill-dev/tap/drill

# curl
curl -fsSL https://drill.dev/install.sh | sh
```
- Copy-to-clipboard button on each
- "Works on macOS, Linux, Windows (WSL)"

### Pricing section (inline on homepage)
Three cards: Free / Pro / Teams
- Free: $0, 20 runs/month
- Pro: $19/mo, unlimited
- Teams: $49/mo, unlimited + seats + CI
- Upgrade CTA on Pro: links to /pricing

### Social proof section
- "Used by engineers at..." (logos — placeholder until real customers)
- Quote cards from beta users

---

## Dashboard page spec (app/(dashboard)/dashboard/page.tsx)

```typescript
// Protected by Clerk middleware
// Shows:
// 1. API key widget — masked display (drill_sk_***...xxx), copy button, regenerate button
// 2. Usage widget — circular progress: {run_count}/{run_limit} runs this month
// 3. Plan badge — color-coded: Free(gray) / Pro(purple) / Teams(teal) / Enterprise(gold)
// 4. Upgrade CTA — shown only on free plan
// 5. Quick start code — personalized with their actual API key (hidden by default, reveal on click)
// 6. Docs links — CLI reference, SDK docs, GitHub Action
```

---

## CLI auth page spec (app/(auth)/cli-auth/page.tsx)

```typescript
// URL: /cli-auth?state=<uuid>&device=<hostname>
// 1. Show: "Authorizing Drill CLI on {device}"
// 2. User must be signed in (Clerk) — if not, redirect to sign-in with returnUrl
// 3. On load: POST /api/cli-auth/confirm with state from query param
// 4. On success: redirect to /cli-auth/success
// 5. On error: show error message with retry link
// Security: validate state param is a valid UUID format before proceeding
```

---

## Middleware — auth protection

```typescript
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/admin(.*)',
]);

const isAdminRoute = createRouteMatcher(['/admin(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth();
    if (!sessionClaims?.metadata?.isAdmin) {
      return Response.redirect(new URL('/dashboard', req.url));
    }
  }
});
```

---

## Stripe integration — packages/web/lib/stripe.ts

```typescript
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-01-27.acacia',
  typescript: true,
});

// Products (create in Stripe dashboard, store price IDs in env):
// STRIPE_PRO_PRICE_ID     — $19/mo recurring
// STRIPE_TEAMS_PRICE_ID   — $49/mo recurring

export async function createCheckoutSession(userId: string, email: string, priceId: string): Promise<string> {
  // Creates Stripe Checkout session, returns URL
  // Success URL: /dashboard?upgraded=true
  // Cancel URL: /pricing
}

export async function createBillingPortalSession(stripeCustomerId: string): Promise<string> {
  // Returns Stripe Billing Portal URL for managing subscription
}
```

---

## Tailwind + design tokens

```typescript
// tailwind.config.ts
// Brand colors:
// --drill-purple: #2D1B69
// --drill-teal: #0F6E56
// --drill-surface: #0F0A1E (dark bg)
// --drill-terminal: #1E1E1E (code blocks)

// Typography: Inter for UI, JetBrains Mono for code
// Fonts loaded via next/font
```

---

## install.sh — the curl install script

Served at `drill.dev/install.sh` (static file in `public/install.sh`):

```bash
#!/bin/sh
set -e

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

echo "Installing drill-cli..."

# Check for Node.js 18+
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VERSION" -ge 18 ]; then
    npm install -g drill-cli
    echo "Installed via npm"
    echo "Run: drill login"
    exit 0
  fi
fi

# Fallback: check for brew
if command -v brew >/dev/null 2>&1; then
  brew install drill-dev/tap/drill
  echo "Installed via Homebrew"
  echo "Run: drill login"
  exit 0
fi

echo "Error: Node.js 18+ or Homebrew required"
echo "Install Node.js: https://nodejs.org"
exit 1
```
