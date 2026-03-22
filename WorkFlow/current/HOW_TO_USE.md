# How to use these files with OpenCode + MiniMax M2.5

> **Current scope note:** Only Phases 1–5 are in scope for v1 (CLI-only, BYO-key).
> Phases 6–10 are in `WorkFlow/future/` and marked accordingly. Do not build them yet.

## What you have

```
drill/
  AGENTS.md              ← loaded automatically every session
  package.json           ← monorepo root
  specs/
    SPEC_CLI.md          ← CLI binary contracts
    SPEC_PROMPTS.md      ← LLM prompt engineering

  WorkFlow/
    current/             ← ACTIVE — Phases 1–5 (CLI v1 scope)
      HOW_TO_USE.md      ← this file
      PHASE_01.md        ← Monorepo scaffold + types + redact + chunk
      PHASE_02.md        ← LLM call: stream parser + API client + prompt
      PHASE_03.md        ← CLI binary: run command, render, full pipe flow
      PHASE_04.md        ← CLI commands: watch, config, context
      PHASE_05.md        ← Core tests: all unit tests, fixtures, CI gate
    future/              ← OUT OF SCOPE — Phases 6–10 (future work)
      PHASE_06.md        ← Backend API: managed service layer
      PHASE_07.md        ← Auth + database: Clerk, Supabase
      PHASE_08.md        ← Billing: Stripe, plans, rate limits
      PHASE_09.md        ← Web: marketing site, dashboard
      PHASE_10.md        ← SDK, GitHub Action, Homebrew, launch
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

# 4. Set your MiniMax API key in environment or run `drill setup`
# 5. Initialize pnpm workspace
pnpm install

# 6. Open OpenCode in this directory
opencode .
```

Your project root should look like:
```
drill/
  AGENTS.md
  package.json
  specs/
    SPEC_CLI.md
    SPEC_PROMPTS.md
  WorkFlow/
    current/
      HOW_TO_USE.md
      PHASE_01.md through PHASE_05.md
    future/
      PHASE_06.md through PHASE_10.md
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

---

## Phase map — what gets built when

### Phases 1–5: Core CLI product (v1 — CURRENT SCOPE)
No login. No payment. No database. No web server.
Just: `any log | drill` → answer in terminal.

```
Phase 1 → The scaffold + pure logic layer (redact, chunk, types)
Phase 2 → The LLM integration (M2.5 streaming, prompt, parser)
Phase 3 → The CLI binary (the actual `drill` command you run)
Phase 4 → Power CLI features (watch, config, CI mode)
Phase 5 → Complete test suite + all fixtures passing
```

After Phase 5: you have a working `drill` binary that calls LLM providers directly.
Users provide their own API key via `drill setup`. No account required.

### Phases 6–10: Future scope (NOT being built yet)
Stored in `WorkFlow/future/` with scope markers. These will be built after v1 ships.

```
Phase 6 → Backend API route (managed service layer)
Phase 7 → Auth + database (Clerk + Supabase)
Phase 8 → Billing (Stripe, plans, rate limits, upgrade flow)
Phase 9 → Web (marketing site, dashboard)
Phase 10 → SDK, GitHub Action, Homebrew, launch
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

**"Should I build Phase 6+?"**
→ No. Phases 6–10 are in `WorkFlow/future/`. Only build Phases 1–5 for now.
