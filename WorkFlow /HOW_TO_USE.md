# How to use these files with OpenCode + MiniMax M2.5

## What you have

```
drill-ai-files/
  AGENTS.md              ← loaded automatically every session
  opencode.json          ← points OpenCode at MiniMax M2.5
  package.json           ← monorepo root
  specs/
    SPEC_CLI.md          ← CLI binary contracts
    SPEC_API.md          ← backend API contracts
    SPEC_PROMPTS.md      ← LLM prompt engineering
    SPEC_DATABASE.md     ← Supabase schema + migrations
    SPEC_WEB.md          ← website + frontend
    SPEC_SDK.md          ← Node + Python SDK
    SPEC_ACTION.md       ← GitHub Action
    SPEC_TESTING.md      ← test strategy + fixtures

drill-phases/
  HOW_TO_USE.md          ← this file
  PHASE_01.md            ← Monorepo scaffold + types + redact + chunk
  PHASE_02.md            ← LLM call: stream parser + API client + prompt
  PHASE_03.md            ← CLI binary: run command, render, full pipe flow
  PHASE_04.md            ← CLI commands: watch, config, status, context
  PHASE_05.md            ← Core tests: all unit tests, fixtures, CI gate
  PHASE_06.md            ← Backend API: /api/analyze route, env validation
  PHASE_07.md            ← Auth + database: Clerk, Supabase, migrations
  PHASE_08.md            ← Billing: Stripe, plans, upgrade flow, rate limits
  PHASE_09.md            ← Web: marketing site, dashboard, CLI auth page
  PHASE_10.md            ← SDK, GitHub Action, Homebrew, npm publish, launch
```

---

## Step 1 — project setup (do this once, before any phase)

```bash
# 1. Create your project folder
mkdir drill && cd drill

# 2. Copy ALL files from drill-ai-files/ into it
cp -r /path/to/drill-ai-files/. .

# 3. Copy the phases folder in too (OpenCode will reference them)
cp -r /path/to/drill-phases/specs ./specs  # already done from above

# 4. Open opencode.json and insert your MiniMax API key
# Replace "YOUR_MINIMAX_API_KEY_HERE" with your actual key

# 5. Initialize pnpm workspace
pnpm install

# 6. Open OpenCode in this directory
opencode .
```

Your project root should look like:
```
drill/
  AGENTS.md
  opencode.json
  package.json
  specs/
    SPEC_CLI.md
    SPEC_API.md
    SPEC_PROMPTS.md
    SPEC_DATABASE.md
    SPEC_WEB.md
    SPEC_SDK.md
    SPEC_ACTION.md
    SPEC_TESTING.md
  PHASE_01.md
  PHASE_02.md
  ... (all 10 phase files at root)
```

---

## Step 2 — how to run a phase in OpenCode

Each phase is a complete, self-contained build instruction. You feed it to OpenCode like this:

### Method A — paste the phase prompt directly

Open OpenCode. In the chat input, type:

```
Read PHASE_01.md and build everything in it completely.
Do not move to the next phase until every exit criteria item passes.
```

OpenCode reads `AGENTS.md` automatically. It will then read `PHASE_01.md` and execute.

### Method B — reference the file

```
@PHASE_01.md Build this phase completely.
```

### What to say when it finishes

When the phase output looks complete, verify with:

```
Run the exit criteria checks for PHASE_01.md.
Show me the output of each check command.
```

If all pass, move to next phase:

```
Phase 1 is complete. Read PHASE_02.md and build everything in it.
```

---

## Step 3 — validation between phases

After each phase, run this sequence manually in your terminal:

```bash
pnpm typecheck        # zero TypeScript errors
pnpm lint             # zero lint errors
pnpm test             # all tests pass
pnpm build            # builds without warnings
```

**Do not proceed to the next phase if any command fails.**
Tell OpenCode: `pnpm test is failing with this error: [paste error]` and let it fix.

---

## Step 4 — environment variables

Before Phase 6 (backend), you need these services set up:

| Service | What to do | Where to get key |
|---|---|---|
| MiniMax M2.5 | Already in opencode.json | api.minimax.io |
| Together AI | Sign up at together.ai | together.ai/settings |
| Supabase | Create project at supabase.com | Project settings → API |
| Clerk | Create app at clerk.com | Clerk dashboard → API Keys |
| Stripe | Create account at stripe.com | Stripe dashboard → API Keys |
| Upstash Redis | Create DB at upstash.com | Upstash console |

Create `packages/web/.env.local` with all variables from AGENTS.md before Phase 6.

---

## Phase map — what gets built when

### Phases 1–5: Core validation product
No login. No payment. No database. No web server.
Just: `any log | drill` → answer in terminal.
Goal: prove the core mechanic works perfectly before building anything else.

```
Phase 1 → The scaffold + pure logic layer (redact, chunk, types)
Phase 2 → The LLM integration (M2.5 streaming, prompt, parser)
Phase 3 → The CLI binary (the actual `drill` command you run)
Phase 4 → Power CLI features (watch, context, CI mode, config)
Phase 5 → Complete test suite + all fixtures passing
```

After Phase 5: you have a working `drill` binary that calls M2.5 directly
(using a hardcoded API key in .env) and works perfectly from any terminal.
This is what you validate the product with.

### Phases 6–10: Production layer
Auth, billing, web, SDK, distribution.
Built on top of a proven core.

```
Phase 6 → Backend API route (the managed service layer)
Phase 7 → Auth + database (Clerk + Supabase)
Phase 8 → Billing (Stripe, plans, rate limits, upgrade flow)
Phase 9 → Web (marketing site, dashboard, CLI auth)
Phase 10 → SDK, GitHub Action, Homebrew, npm publish, launch
```

---

## Important: how OpenCode reads context

`AGENTS.md` is always loaded. It tells the model:
- The stack (non-negotiable)
- The rules (TypeScript strict, no TODOs, stream everything)
- Which SPEC file to read before building each domain

The SPEC files are deep contracts — every file path, function signature, type, edge case.
The PHASE files are execution plans — what to build, in what order, with what exit criteria.

The model reads AGENTS.md automatically.
You feed it one PHASE file at a time.
It reads the relevant SPEC files on its own when it hits domain work.

---

## Troubleshooting

**"The model is building things that weren't in the spec"**
→ Say: `Stop. Read AGENTS.md rule 4. Read SPEC_CLI.md section [X]. Build only what is specified.`

**"TypeScript errors after a phase"**
→ Say: `pnpm typecheck returns these errors: [paste]. Fix all of them before continuing.`

**"Tests are failing"**
→ Say: `pnpm test returns these failures: [paste]. Fix the implementation to make tests pass.`

**"The build is succeeding but drill doesn't work"**
→ Say: `Run: echo "Error: ECONNREFUSED" | node packages/cli/dist/index.js and show me the output.`

**"M2.5 is not returning JSON"**
→ The retry logic in SPEC_PROMPTS.md handles this. Say: `Implement the parse retry logic from specs/SPEC_PROMPTS.md section "Retry logic for parse failures".`
