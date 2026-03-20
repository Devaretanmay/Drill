# Phase 9 — Web: marketing site, dashboard, CLI auth page

## What this phase builds

The complete public-facing website. Marketing homepage, pricing page, full documentation,
user dashboard with API key management, CLI auth browser page, settings, and admin panel.
After this phase drill.dev is a complete, professional product website that converts
visitors into users and communicates the product clearly.

## Depends on

Phases 6, 7, 8 complete. Users can sign up, authenticate CLI, and upgrade plans.

## Scope

- `packages/web/app/(marketing)/page.tsx` — homepage with animated terminal demo
- `packages/web/app/(marketing)/pricing/page.tsx` — detailed pricing page
- `packages/web/app/(marketing)/docs/page.tsx` — docs index
- `packages/web/app/(marketing)/docs/cli/page.tsx` — CLI reference
- `packages/web/app/(marketing)/docs/sdk/page.tsx` — SDK docs
- `packages/web/app/(marketing)/docs/action/page.tsx` — GitHub Action docs
- `packages/web/app/(marketing)/changelog/page.tsx` — version history
- `packages/web/app/(auth)/cli-auth/page.tsx` — CLI login browser auth page
- `packages/web/app/(auth)/cli-auth/success/page.tsx` — success confirmation
- `packages/web/app/(dashboard)/dashboard/page.tsx` — user dashboard
- `packages/web/app/(dashboard)/dashboard/_components/ApiKeyCard.tsx`
- `packages/web/app/(dashboard)/dashboard/_components/UsageCard.tsx`
- `packages/web/app/(dashboard)/dashboard/_components/QuickStart.tsx`
- `packages/web/app/(dashboard)/settings/page.tsx` — account + billing settings
- `packages/web/app/(admin)/admin/page.tsx` — admin overview
- `packages/web/components/CopyButton.tsx`
- `packages/web/components/TerminalDemo.tsx`
- `packages/web/components/InstallTabs.tsx`
- `packages/web/components/PricingCard.tsx`
- `packages/web/public/install.sh` — curl install script

---

## Design tokens: packages/web/app/globals.css

Add to existing globals.css after base Tailwind directives:

```css
:root {
  --drill-surface:       #0F0A1E;
  --drill-surface-2:    #1A1230;
  --drill-purple:       #2D1B69;
  --drill-purple-light: #4C3399;
  --drill-teal:         #0F6E56;
  --drill-teal-light:   #1AA382;
  --drill-terminal:     #1E1E1E;
  --drill-dim:          #888899;
  --drill-border:       rgba(255,255,255,0.08);
  --drill-text:         #F0EEF8;
  --drill-text-muted:   #9994BB;
}
```

Fonts via `packages/web/app/layout.tsx`:
```tsx
import { Inter, JetBrains_Mono } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
// Apply both variables to <html> classname
```

Tailwind custom config additions in `tailwind.config.ts`:
```ts
theme: {
  extend: {
    fontFamily: {
      sans: ['var(--font-inter)'],
      mono: ['var(--font-mono)'],
    },
    keyframes: {
      fadeIn: {
        '0%': { opacity: '0', transform: 'translateY(4px)' },
        '100%': { opacity: '1', transform: 'translateY(0)' },
      },
    },
    animation: {
      fadeIn: 'fadeIn 0.3s ease forwards',
    },
  },
},
```

---

## File: packages/web/components/CopyButton.tsx

```tsx
'use client';
import { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
}

export function CopyButton({ text, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — ignore silently
    }
  }

  return (
    <button
      onClick={() => void handleCopy()}
      className="text-xs px-2 py-1 rounded border border-white/20 text-white/60
                 hover:text-white hover:border-white/40 transition-all duration-150"
      aria-label={`Copy ${label}`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
```

---

## File: packages/web/components/TerminalDemo.tsx

```tsx
'use client';
// Pure CSS animation — no JS timers. Each line fades in with animation-delay.
const LINES: Array<{ text: string; cls: string; delay: string }> = [
  { text: '$ docker logs my-api 2>&1 | drill',            cls: 'text-white',            delay: '0s'   },
  { text: '  Reading 847 lines...',                       cls: 'text-white/40',         delay: '0.5s' },
  { text: '  ▸ checking connection pool pattern',         cls: 'text-white/40',         delay: '1.2s' },
  { text: '  ▸ temporal correlation at 14:07:33',         cls: 'text-white/40',         delay: '1.9s' },
  { text: '  ▸ cross-referencing pg max_connections',     cls: 'text-white/40',         delay: '2.6s' },
  { text: '',                                             cls: '',                      delay: '3.2s' },
  { text: '┌─ DRILL ──────────── Confidence: 87% ──┐',   cls: 'text-purple-300',       delay: '3.4s' },
  { text: '│                                        │',   cls: 'text-purple-300',       delay: '3.5s' },
  { text: '│  Cause:    DB pool exhausted (max 10)  │',   cls: 'text-white',            delay: '3.6s' },
  { text: '│  Severity: 🟠 HIGH                     │',   cls: 'text-white',            delay: '3.7s' },
  { text: '│  Fix:      Set DB_POOL_SIZE=25 in .env │',   cls: 'text-cyan-300',         delay: '3.8s' },
  { text: '│                                        │',   cls: 'text-purple-300',       delay: '3.9s' },
  { text: '│  Evidence: "remaining connection slots │',   cls: 'text-white/50',         delay: '4.0s' },
  { text: '│            reserved" at 14:07:33       │',   cls: 'text-white/50',         delay: '4.0s' },
  { text: '│                                        │',   cls: 'text-purple-300',       delay: '4.1s' },
  { text: '└────────────────────────────────────────┘',   cls: 'text-purple-300',       delay: '4.2s' },
];

export function TerminalDemo() {
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1E1E1E] font-mono text-sm">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#2A2A2A] border-b border-white/5">
        <span className="w-3 h-3 rounded-full bg-red-500/80" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <span className="w-3 h-3 rounded-full bg-green-500/80" />
        <span className="ml-3 text-white/30 text-xs">Terminal</span>
      </div>
      {/* Content */}
      <div className="p-6 space-y-[2px] leading-6">
        {LINES.map((line, i) => (
          <div
            key={i}
            className={`${line.cls} opacity-0 animate-fadeIn`}
            style={{ animationDelay: line.delay, animationFillMode: 'forwards' }}
          >
            {line.text || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## File: packages/web/components/InstallTabs.tsx

```tsx
'use client';
import { useState } from 'react';
import { CopyButton } from './CopyButton';

const TABS = [
  { id: 'npm',  label: 'npm',  command: 'npm install -g drill-cli' },
  { id: 'brew', label: 'brew', command: 'brew install drill-dev/tap/drill' },
  { id: 'curl', label: 'curl', command: 'curl -fsSL https://drill.dev/install.sh | sh' },
] as const;

type TabId = typeof TABS[number]['id'];

export function InstallTabs() {
  const [active, setActive] = useState<TabId>('npm');
  const tab = TABS.find(t => t.id === active)!;

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-[#1E1E1E] font-mono text-sm w-full max-w-xl">
      {/* Headers */}
      <div className="flex border-b border-white/10">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`px-5 py-2.5 text-sm transition-colors ${
              active === t.id
                ? 'text-white border-b-2 border-purple-400 bg-white/5'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Command */}
      <div className="flex items-center justify-between px-4 py-3 gap-4">
        <span className="text-white/90 flex-1">{tab.command}</span>
        <CopyButton text={tab.command} />
      </div>
      <p className="px-4 pb-3 text-white/30 text-xs">
        macOS · Linux · Windows (WSL) · Requires Node.js 18+
      </p>
    </div>
  );
}
```

---

## File: packages/web/components/PricingCard.tsx

```tsx
import Link from 'next/link';

interface PricingCardProps {
  name: string;
  price: string;
  period?: string;
  description: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlighted?: boolean;
}

export function PricingCard({
  name, price, period = '/month', description,
  features, cta, ctaHref, highlighted = false,
}: PricingCardProps) {
  return (
    <div className={`relative rounded-2xl p-8 flex flex-col border ${
      highlighted
        ? 'border-purple-500 bg-purple-950/30'
        : 'border-white/10 bg-white/5'
    }`}>
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <span className="bg-purple-500 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
            MOST POPULAR
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-xl font-bold text-white mb-1">{name}</h3>
        <p className="text-white/50 text-sm mb-4">{description}</p>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold text-white">{price}</span>
          {price !== 'Free' && <span className="text-white/50 text-sm">{period}</span>}
        </div>
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {features.map(f => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-white/75">
            <span className="text-teal-400 mt-px flex-shrink-0">✓</span>
            {f}
          </li>
        ))}
      </ul>

      <Link
        href={ctaHref}
        className={`text-center py-3 px-6 rounded-xl font-semibold transition-all ${
          highlighted
            ? 'bg-purple-500 hover:bg-purple-400 text-white'
            : 'border border-white/20 hover:border-white/40 text-white hover:bg-white/5'
        }`}
      >
        {cta}
      </Link>
    </div>
  );
}
```

---

## File: packages/web/app/(marketing)/page.tsx

```tsx
import Link from 'next/link';
import { TerminalDemo } from '@/components/TerminalDemo';
import { InstallTabs } from '@/components/InstallTabs';
import { PricingCard } from '@/components/PricingCard';

const LOG_SOURCES = [
  { label: 'Docker',      cmd: 'docker logs my-api 2>&1 | drill' },
  { label: 'Kubernetes',  cmd: 'kubectl logs my-pod | drill'      },
  { label: 'Log files',   cmd: 'cat error.log | drill'            },
  { label: 'CI builds',   cmd: 'npm run build 2>&1 | drill'       },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white">

      {/* Nav */}
      <nav className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">drill</span>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/docs" className="text-white/60 hover:text-white transition-colors">Docs</Link>
            <Link href="/pricing" className="text-white/60 hover:text-white transition-colors">Pricing</Link>
            <Link href="/sign-in" className="text-white/60 hover:text-white transition-colors">Sign in</Link>
            <Link href="/sign-up"
              className="bg-white text-black px-4 py-1.5 rounded-lg font-semibold hover:bg-white/90 transition-colors text-sm">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-950/60 border border-purple-500/30
                        text-purple-300 text-xs font-medium px-3 py-1 rounded-full mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          Powered by MiniMax M2.5 — #1 open model on SWE-Bench
        </div>

        <h1 className="text-6xl font-bold leading-tight tracking-tight mb-6">
          Your logs know why.
          <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-teal-400">
            Drill finds it.
          </span>
        </h1>

        <p className="text-xl text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
          Pipe any log stream into Drill and get a plain-English root cause in under 60 seconds.
          No setup. No dashboard. No agents.
        </p>

        <div className="flex items-center justify-center gap-4 mb-16">
          <a href="#install"
            className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-white/90 transition-all text-lg">
            Install free
          </a>
          <Link href="/docs"
            className="border border-white/20 text-white px-8 py-3 rounded-xl font-bold hover:bg-white/5 transition-all text-lg">
            View docs
          </Link>
        </div>

        <div className="max-w-2xl mx-auto">
          <TerminalDemo />
        </div>
      </section>

      {/* Works with everything */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-4">Works with everything</h2>
          <p className="text-white/50 text-center mb-12 max-w-lg mx-auto">
            Any log source. Any language. Any environment. If it writes to stdout, Drill reads it.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {LOG_SOURCES.map(src => (
              <div key={src.label} className="bg-white/5 border border-white/10 rounded-xl p-4">
                <p className="text-white/40 text-xs mb-2">{src.label}</p>
                <code className="text-green-400 text-xs font-mono leading-relaxed">{src.cmd}</code>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold mb-4">Start in 30 seconds</h2>
          <p className="text-white/50 mb-10">No account required for your first 3 analyses.</p>
          <div className="flex justify-center">
            <InstallTabs />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-white/5 py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-center mb-4">Simple pricing</h2>
          <p className="text-white/50 text-center mb-12">Start free. Upgrade when you need more.</p>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <PricingCard name="Free" price="Free"
              description="For individuals getting started"
              features={['20 analyses/month', 'All CLI flags', 'PII redaction', 'Direct M2.5']}
              cta="Get started" ctaHref="/sign-up" />
            <PricingCard name="Pro" price="$19"
              description="For engineers who ship fast"
              features={['Unlimited analyses', '--watch mode', '--context codebase scan', 'GitHub Action', 'Priority support']}
              cta="Upgrade to Pro" ctaHref="/sign-up?plan=pro" highlighted />
            <PricingCard name="Teams" price="$49"
              description="For engineering teams"
              features={['Unlimited analyses', '10 team seats', 'CI pipeline token', 'Shared dashboard']}
              cta="Start team trial" ctaHref="/sign-up?plan=teams" />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between text-white/30 text-sm">
          <span>© {new Date().getFullYear()} Drill. MIT licensed CLI.</span>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-white/60 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-white/60 transition-colors">Terms</Link>
            <a href="https://github.com/drill-dev/drill-cli" className="hover:text-white/60 transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
```

---

## File: packages/web/app/(dashboard)/dashboard/page.tsx

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase';
import { ApiKeyCard } from './_components/ApiKeyCard';
import { UsageCard } from './_components/UsageCard';
import { QuickStart } from './_components/QuickStart';
import Link from 'next/link';

const PLAN_BADGE: Record<string, string> = {
  free:       'bg-white/10 text-white/60',
  pro:        'bg-purple-600/30 text-purple-300 border border-purple-500/30',
  teams:      'bg-teal-600/30 text-teal-300 border border-teal-500/30',
  enterprise: 'bg-yellow-600/30 text-yellow-300 border border-yellow-500/30',
};

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const supabase = createServerClient();
  const { data: user } = await supabase
    .from('users')
    .select('email, plan, api_key, run_count, run_limit')
    .eq('clerk_id', userId)
    .single();

  if (!user) redirect('/sign-in');

  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white px-6 py-12">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-white/40 text-sm mt-1">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${PLAN_BADGE[user.plan] ?? PLAN_BADGE['free']}`}>
              {user.plan.toUpperCase()}
            </span>
            <Link href="/settings" className="text-white/40 hover:text-white text-sm transition-colors">
              Settings
            </Link>
          </div>
        </div>

        <div className="space-y-6">
          <ApiKeyCard apiKey={user.api_key} />
          <UsageCard runCount={user.run_count} runLimit={user.run_limit} plan={user.plan} />

          {/* Upgrade CTA — free plan only */}
          {user.plan === 'free' && (
            <div className="bg-purple-950/30 border border-purple-500/30 rounded-2xl p-6
                            flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-purple-200">Upgrade to Pro — $19/month</p>
                <p className="text-sm text-white/50 mt-1">Unlimited analyses, GitHub Action, priority support</p>
              </div>
              <Link href="/pricing"
                className="bg-purple-500 hover:bg-purple-400 text-white px-6 py-2 rounded-xl font-semibold
                           transition-colors whitespace-nowrap">
                Upgrade
              </Link>
            </div>
          )}

          <QuickStart apiKey={user.api_key} />

          {/* Docs links */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { href: '/docs/cli',    title: 'CLI Reference', desc: 'All commands and flags' },
              { href: '/docs/sdk',    title: 'SDK Docs',      desc: 'Node.js and Python' },
              { href: '/docs/action', title: 'GitHub Action', desc: 'CI/CD integration'  },
            ].map(link => (
              <Link key={link.href} href={link.href}
                className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
                <p className="font-semibold text-sm">{link.title}</p>
                <p className="text-xs text-white/40 mt-1">{link.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
```

---

## File: packages/web/app/(dashboard)/dashboard/_components/ApiKeyCard.tsx

```tsx
'use client';
import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

export function ApiKeyCard({ apiKey }: { apiKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const masked = `${apiKey.slice(0, 12)}${'•'.repeat(24)}${apiKey.slice(-4)}`;

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-white/50 font-medium">API Key</p>
        <p className="text-xs text-white/30">Used to authenticate CLI and SDK</p>
      </div>
      <div className="flex items-center justify-between bg-black/40 rounded-xl px-4 py-3 font-mono text-sm gap-4">
        <span className="text-white/80 flex-1 overflow-hidden text-ellipsis">
          {revealed ? apiKey : masked}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setRevealed(r => !r)}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            {revealed ? 'Hide' : 'Reveal'}
          </button>
          <CopyButton text={apiKey} label="Copy" />
        </div>
      </div>
      <p className="text-xs text-white/30 mt-3">
        Set as{' '}
        <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/60">DRILL_API_KEY</code>
        {' '}in your shell or run{' '}
        <code className="bg-white/10 px-1.5 py-0.5 rounded text-white/60">drill login</code>
      </p>
    </div>
  );
}
```

---

## File: packages/web/app/(dashboard)/dashboard/_components/UsageCard.tsx

```tsx
export function UsageCard({
  runCount, runLimit, plan,
}: {
  runCount: number;
  runLimit: number;
  plan: string;
}) {
  const isUnlimited = runLimit >= 999999;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((runCount / runLimit) * 100));
  const barColor = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-teal-500';
  const resetDate = new Date();
  resetDate.setMonth(resetDate.getMonth() + 1, 1);
  const resetStr = resetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-white/50 font-medium">Analyses this month</p>
        <p className="text-sm font-mono text-white/80">
          {runCount.toLocaleString()} / {isUnlimited ? '∞' : runLimit.toLocaleString()}
        </p>
      </div>

      {isUnlimited ? (
        <p className="text-sm text-teal-400">
          Unlimited runs on {plan} plan
        </p>
      ) : (
        <>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full ${barColor} rounded-full transition-all duration-700`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-white/30">
            Resets {resetStr} · {Math.max(0, runLimit - runCount)} runs remaining
          </p>
        </>
      )}
    </div>
  );
}
```

---

## File: packages/web/app/(dashboard)/dashboard/_components/QuickStart.tsx

```tsx
'use client';
import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';

export function QuickStart({ apiKey }: { apiKey: string }) {
  const [showKey, setShowKey] = useState(false);
  const displayKey = showKey ? apiKey : 'YOUR_API_KEY';

  const snippets = [
    { comment: '# Install', code: 'npm install -g drill-cli' },
    { comment: '# Authenticate', code: `export DRILL_API_KEY=${displayKey}` },
    { comment: '# Analyze any log', code: 'docker logs my-api 2>&1 | drill' },
  ];

  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm font-semibold">Quick start</p>
        <button
          onClick={() => setShowKey(k => !k)}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          {showKey ? 'Hide key' : 'Insert my key'}
        </button>
      </div>

      <div className="space-y-4 font-mono text-sm">
        {snippets.map(s => (
          <div key={s.comment}>
            <p className="text-white/30 text-xs mb-1">{s.comment}</p>
            <div className="flex items-center justify-between bg-black/40 rounded-lg px-3 py-2">
              <span className="text-white/80">{s.code}</span>
              <CopyButton text={s.code} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## File: packages/web/app/(auth)/cli-auth/page.tsx

```tsx
'use client';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser, SignIn } from '@clerk/nextjs';
import { useEffect, useState, Suspense } from 'react';

function CliAuthContent() {
  const params = useSearchParams();
  const state  = params.get('state') ?? '';
  const device = params.get('device') ?? 'your terminal';
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [status, setStatus] = useState<'waiting' | 'confirming' | 'done' | 'error'>('waiting');

  const stateValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(state);

  useEffect(() => {
    if (!isLoaded || !user || !stateValid || status !== 'waiting') return;
    setStatus('confirming');

    void fetch('/api/cli-auth/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
      .then(r => r.json() as Promise<{ success: boolean }>)
      .then(data => {
        if (data.success) {
          setStatus('done');
          setTimeout(() => router.push('/cli-auth/success'), 1200);
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, [isLoaded, user, state, stateValid, status, router]);

  if (!stateValid) {
    return (
      <div className="text-center">
        <p className="text-red-400 mb-3">Invalid authorization link.</p>
        <p className="text-white/50 text-sm">
          Run <code className="bg-white/10 px-1.5 rounded">drill login</code> again to get a fresh link.
        </p>
      </div>
    );
  }

  if (!isLoaded) return <div className="text-white/40 text-center">Loading...</div>;

  if (!user) {
    return (
      <div>
        <p className="text-center text-white/60 text-sm mb-6">
          Sign in to authorize{' '}
          <strong className="text-white font-medium">{decodeURIComponent(device)}</strong>
        </p>
        <SignIn
          redirectUrl={`/cli-auth?state=${state}&device=${device}`}
          appearance={{ elements: { rootBox: 'w-full', card: 'bg-white/5 border border-white/10 rounded-2xl' } }}
        />
      </div>
    );
  }

  return (
    <div className="text-center">
      {status === 'confirming' && (
        <>
          <div className="w-10 h-10 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
          <p className="text-white/70">Connecting {decodeURIComponent(device)}...</p>
        </>
      )}
      {status === 'done' && (
        <>
          <div className="text-5xl mb-5">✓</div>
          <p className="text-green-400 font-semibold text-xl mb-2">Authorized!</p>
          <p className="text-white/50 text-sm">Redirecting...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="text-red-400 mb-3 font-semibold">Authorization failed</p>
          <p className="text-white/50 text-sm">
            Run <code className="bg-white/10 px-1.5 rounded">drill login</code> to try again.
          </p>
        </>
      )}
    </div>
  );
}

export default function CliAuthPage() {
  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <span className="font-bold text-2xl">drill</span>
          <p className="text-white/40 text-sm mt-2">CLI Authorization</p>
        </div>
        <Suspense fallback={<div className="text-white/40 text-center">Loading...</div>}>
          <CliAuthContent />
        </Suspense>
      </div>
    </main>
  );
}
```

---

## File: packages/web/app/(auth)/cli-auth/success/page.tsx

```tsx
import Link from 'next/link';

export default function CliAuthSuccessPage() {
  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-7xl mb-6">✓</div>
        <h1 className="text-3xl font-bold mb-3">CLI authorized</h1>
        <p className="text-white/50 mb-10 leading-relaxed">
          Your terminal is connected to Drill.
          You can close this window and return to your shell.
        </p>
        <div className="bg-[#1E1E1E] border border-white/10 rounded-xl p-5 font-mono text-sm text-left mb-8">
          <p className="text-white/30 text-xs mb-3"># You can now run any of these:</p>
          <p className="text-white/80 mb-1">docker logs my-api 2>&1 | drill</p>
          <p className="text-white/80 mb-1">cat error.log | drill</p>
          <p className="text-white/80">drill --help</p>
        </div>
        <Link href="/dashboard" className="text-purple-400 hover:text-purple-300 text-sm transition-colors">
          Go to dashboard →
        </Link>
      </div>
    </main>
  );
}
```

---

## File: packages/web/app/(dashboard)/settings/page.tsx

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase';
import Link from 'next/link';

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const supabase = createServerClient();
  const { data: user } = await supabase
    .from('users')
    .select('email, plan, stripe_id, created_at')
    .eq('clerk_id', userId)
    .single();

  if (!user) redirect('/sign-in');

  const memberSince = new Date(user.created_at as string).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white px-6 py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-10">
          <Link href="/dashboard" className="text-white/40 hover:text-white text-sm transition-colors">← Dashboard</Link>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <div className="space-y-6">

          {/* Account */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold mb-5">Account</h2>
            <div className="space-y-4 text-sm">
              <Row label="Email" value={user.email} />
              <Row label="Plan" value={user.plan.charAt(0).toUpperCase() + user.plan.slice(1)} />
              <Row label="Member since" value={memberSince} />
            </div>
          </section>

          {/* Billing */}
          <section className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="font-semibold mb-5">Billing</h2>
            {user.stripe_id ? (
              <div>
                <p className="text-sm text-white/50 mb-4">Manage your subscription, payment method, and invoices.</p>
                <form action="/api/billing/portal" method="POST">
                  <button type="submit"
                    className="border border-white/20 px-5 py-2 rounded-xl text-sm hover:bg-white/5 transition-colors">
                    Open billing portal →
                  </button>
                </form>
              </div>
            ) : (
              <div>
                <p className="text-sm text-white/50 mb-4">You are on the Free plan — 20 analyses per month.</p>
                <Link href="/pricing"
                  className="bg-purple-500 hover:bg-purple-400 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-colors inline-block">
                  Upgrade plan
                </Link>
              </div>
            )}
          </section>

          {/* Danger zone */}
          <section className="border border-red-900/50 rounded-2xl p-6">
            <h2 className="font-semibold text-red-400 mb-3">Danger zone</h2>
            <p className="text-sm text-white/50 mb-5">
              Permanently delete your account and all data. This cannot be undone.
              Active subscriptions must be cancelled first.
            </p>
            <button
              className="border border-red-500/40 text-red-400 px-5 py-2 rounded-xl text-sm
                         hover:bg-red-950/40 transition-colors"
            >
              Delete account
            </button>
          </section>

        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-white/50">{label}</span>
      <span className="text-white/80">{value}</span>
    </div>
  );
}
```

---

## File: packages/web/app/(admin)/admin/page.tsx

```tsx
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase';

export default async function AdminPage() {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect('/sign-in');

  const isAdmin = (sessionClaims?.metadata as { isAdmin?: boolean } | null)?.isAdmin;
  if (!isAdmin) redirect('/dashboard');

  const supabase = createServerClient();

  const [
    { count: totalUsers },
    { count: activeUsers },
    { data: planRows },
    { data: topUsers },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }).gt('run_count', 0),
    supabase.from('users').select('plan'),
    supabase.from('users').select('email, plan, run_count, run_limit').order('run_count', { ascending: false }).limit(20),
  ]);

  const planDist = (planRows ?? []).reduce((acc: Record<string, number>, row) => {
    acc[row.plan] = (acc[row.plan] ?? 0) + 1;
    return acc;
  }, {});

  const stats = [
    { label: 'Total users',        value: totalUsers ?? 0 },
    { label: 'Active this month',  value: activeUsers ?? 0 },
    { label: 'Free',               value: planDist['free'] ?? 0 },
    { label: 'Paid (Pro + Teams)', value: (planDist['pro'] ?? 0) + (planDist['teams'] ?? 0) },
  ];

  return (
    <main className="min-h-screen bg-[#0F0A1E] text-white px-6 py-12">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-10">Admin</h1>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {stats.map(s => (
            <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <p className="text-white/40 text-xs mb-2">{s.label}</p>
              <p className="text-3xl font-bold">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Top users table */}
        <h2 className="font-semibold mb-4">Top users by run count</h2>
        <div className="rounded-2xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left px-5 py-3 text-white/40 font-medium">Email</th>
                <th className="px-5 py-3 text-white/40 font-medium">Plan</th>
                <th className="px-5 py-3 text-white/40 font-medium">Runs</th>
                <th className="px-5 py-3 text-white/40 font-medium">Limit</th>
              </tr>
            </thead>
            <tbody>
              {(topUsers ?? []).map((u, i) => (
                <tr key={u.email} className={`border-t border-white/5 ${i % 2 ? 'bg-white/[0.02]' : ''}`}>
                  <td className="px-5 py-3 text-white/70">{u.email}</td>
                  <td className="px-5 py-3 text-center capitalize text-white/50">{u.plan}</td>
                  <td className="px-5 py-3 text-center font-mono">{u.run_count}</td>
                  <td className="px-5 py-3 text-center font-mono text-white/40">
                    {u.run_limit >= 999999 ? '∞' : u.run_limit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
```

---

## File: packages/web/public/install.sh

```bash
#!/bin/sh
set -e

DRILL_VERSION="latest"

echo ""
echo "Installing drill-cli..."
echo ""

# Check for Node.js 18+
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    echo "Found Node.js $(node --version). Installing via npm..."
    npm install -g "drill-cli@${DRILL_VERSION}"
    echo ""
    echo "  drill installed!"
    echo ""
    echo "  Get started:"
    echo "    drill login              # Connect your account"
    echo "    cat error.log | drill    # Analyze a log"
    echo "    drill --help             # All options"
    echo ""
    exit 0
  fi
fi

# Check for Homebrew
if command -v brew >/dev/null 2>&1; then
  echo "Node.js 18+ not found. Installing via Homebrew..."
  brew tap drill-dev/tap
  brew install drill
  echo ""
  echo "  drill installed via Homebrew!"
  echo "  Run: drill login"
  echo ""
  exit 0
fi

echo "Error: drill-cli requires Node.js 18+ or Homebrew."
echo ""
echo "  Install Node.js:  https://nodejs.org"
echo "  Install Homebrew: https://brew.sh"
echo ""
echo "Then run:  npm install -g drill-cli"
echo ""
exit 1
```

---

## Exit criteria — Phase 9 is complete when ALL pass

```bash
# 1. Production build zero errors
pnpm --filter web build
# Expected: Build complete, zero TypeScript errors, zero import errors

# 2. Homepage loads + hero text present
pnpm --filter web start &
sleep 3
curl -s http://localhost:3000 | grep "Your logs know why"
# Expected: text found

# 3. Install tabs render + copy buttons present
curl -s http://localhost:3000 | grep "npm install -g drill-cli"

# 4. Pricing page loads with comparison table
curl -s http://localhost:3000/pricing | grep "Feature comparison" 2>/dev/null || \
  curl -s http://localhost:3000/pricing | grep "Comparison"

# 5. Dashboard redirect if not authenticated
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/dashboard
# Expected: 307 (redirect to sign-in)

# 6. CLI auth page loads (valid state param)
curl -s "http://localhost:3000/cli-auth?state=550e8400-e29b-41d4-a716-446655440000&device=macbook" | grep "CLI Authorization"

# 7. install.sh is a valid shell script
curl -s http://localhost:3000/install.sh | head -1
# Expected: #!/bin/sh

# 8. TypeScript zero errors
pnpm --filter web typecheck

# 9. Full manual test: sign up → dashboard → API key copy → drill login flow
# Do this manually before moving to Phase 10.
```
