# SPEC_CLI — packages/cli

## Package identity

```json
{
  "name": "drill-cli",
  "version": "1.0.0",
  "bin": { "drill": "./dist/index.js" },
  "engines": { "node": ">=18.0.0" }
}
```

## Full file structure

```
packages/cli/
  src/
    index.ts                    # Entry: shebang, commander setup, all command registration
    commands/
      run.ts                    # Core: read stdin/arg, redact, chunk, call API, stream output
      watch.ts                  # --watch mode: chokidar tail, auto-detect errors, auto-analyze
      login.ts                  # Open browser to drill.dev/cli-auth, poll for token, save
      logout.ts                 # Remove ~/.drill/config token
      status.ts                 # Show plan, run_count/run_limit, API key (masked)
      config.ts                 # Get/set config values
    lib/
      redact.ts                 # PII redaction — all patterns, fully tested
      chunk.ts                  # Smart log chunking — handles files up to 100MB
      render.ts                 # Terminal output: live trace, result box, error formatting
      api.ts                    # HTTP client: POST /api/analyze, retry logic, timeout
      auth.ts                   # Token R/W from ~/.drill/config using `conf`
      stream.ts                 # SSE parser: split think-tags, buffer result, emit events
      context.ts                # --context: walk directory, build file tree, select relevant files
      upgrade.ts                # Detect limit_reached, show upgrade prompt, open browser
      env.ts                    # Validate DRILL_API_KEY and DRILL_API_URL at startup
    types.ts                    # All shared TypeScript interfaces and types
  test/
    redact.test.ts
    chunk.test.ts
    stream.test.ts
    render.test.ts
    api.test.ts
    context.test.ts
    commands/run.test.ts
    commands/watch.test.ts
  package.json
  tsconfig.json
  build.ts                      # esbuild script
  .eslintrc.json
  vitest.config.ts
```

## types.ts — complete type definitions

```typescript
export interface DrillResult {
  cause: string;           // One sentence, plain English
  confidence: number;      // 0-100
  severity: 'critical' | 'high' | 'medium' | 'low';
  evidence: string[];      // Specific log lines supporting the cause
  fix: string;             // Single most likely fix, specific and actionable
  alternative: string | null;  // Second most likely cause
  missing: string | null;      // What additional info would increase confidence
}

export interface DrillError {
  code: 'LIMIT_REACHED' | 'INVALID_KEY' | 'PARSE_FAILED' | 'TIMEOUT' | 'NETWORK' | 'REDACTED_EMPTY';
  message: string;
  upgrade_url?: string;
}

export interface AnalyzeResponse {
  success: true;
  result: DrillResult;
} | {
  success: false;
  error: DrillError;
}

export interface DrillConfig {
  apiKey: string;
  apiUrl: string;
  plan: string;
  runCount: number;
  runLimit: number;
  model: 'cloud' | 'local';
  localModel?: string;
  redact: boolean;
}

export interface StreamEvent {
  type: 'thinking' | 'result_chunk' | 'done' | 'error';
  content: string;
}

export interface ChunkOptions {
  maxChars: number;      // default 320000 (~80k tokens)
  lastNLines: number;    // default 200
  headLines: number;     // default 20
  contextRadius: number; // default 50 lines around each error
}

export interface ContextFile {
  path: string;
  content: string;
  relevanceScore: number;
}
```

## redact.ts — complete implementation spec

All patterns applied in sequence. `redact()` is pure — given the same input always returns the same output. Unit tested with 100+ real-world log samples.

```typescript
const PATTERNS = [
  { name: 'email',       re: /[\w.+-]+@[\w-]+\.[\w.]+/g,                              sub: '[EMAIL]'      },
  { name: 'ipv4',        re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                          sub: '[IP]'         },
  { name: 'ipv6',        re: /([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,              sub: '[IPv6]'       },
  { name: 'uuid',        re: /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,          sub: '[UUID]'       },
  { name: 'jwt',         re: /eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*/g, sub: '[JWT]' },
  { name: 'aws_key',     re: /(?:AKIA|ASIA|AROA|ANPA|ANVA|APKA)[A-Z0-9]{16}/g,       sub: '[AWS_KEY]'    },
  { name: 'aws_secret',  re: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g, sub: '[AWS_SECRET]' },
  { name: 'bearer',      re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,                     sub: 'Bearer [TOKEN]' },
  { name: 'basic_auth',  re: /Basic\s+[A-Za-z0-9+/]+=*/gi,                           sub: 'Basic [REDACTED]' },
  { name: 'dsn',         re: /[a-z]+:\/\/[^:]+:[^@]+@[^/\s]+/gi,                     sub: '[DSN]'        },
  { name: 'kv_secret',   re: /(password|passwd|secret|token|api[_-]?key|auth[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi, sub: '$1=[REDACTED]' },
  { name: 'phone',       re: /\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, sub: '[PHONE]' },
  { name: 'credit_card', re: /\b(?:\d[ -]?){13,16}\b/g,                              sub: '[CARD]'       },
  { name: 'ssh_key',     re: /-----BEGIN [A-Z ]+KEY-----[\s\S]+?-----END [A-Z ]+KEY-----/g, sub: '[SSH_KEY]' },
];

export function redact(input: string): string {
  return PATTERNS.reduce((s, p) => s.replace(p.re, p.sub), input);
}

export function redactStats(original: string, redacted: string): { patternsApplied: number; charsRemoved: number } {
  // Returns stats for --verbose flag
}
```

## stream.ts — SSE parser with think-tag splitting

```typescript
import { EventSourceParser, createParser } from 'eventsource-parser';

export type StreamHandler = {
  onThinking: (text: string) => void;
  onResultChunk: (text: string) => void;
  onDone: (rawResult: string) => void;
  onError: (err: Error) => void;
};

export async function parseStream(
  response: Response,
  handlers: StreamHandler
): Promise<void> {
  // Splits stream into think-tag content (→ onThinking) and result content (→ onResultChunk)
  // Handles: [DONE] sentinel, malformed chunks, connection drops
  // Buffers full result string, calls onDone with complete JSON when stream ends
  // think-tag parsing: tracks open/close <think>...</think> across chunk boundaries
}
```

## run.ts — complete command spec

```typescript
// drill [input] OR stdin pipe
// Flags:
//   --no-redact          Disable PII redaction
//   --lines <n>          Limit to last N lines (default: all, chunked at 80k tokens)
//   --context <dir>      Add source directory context
//   --json               Output raw JSON to stdout, status to stderr
//   --ci                 Exit code 1 if cause found
//   --local              Route to local Ollama endpoint
//   --model <name>       Local model name (default: llama3.2)
//   --verbose            Show redaction stats, chunk info, timing
//   --timeout <n>        Override request timeout in seconds (default: 90)

// Flow:
// 1. Read input: process.argv[2] (inline) OR read stdin to EOF
// 2. Validate: input must be non-empty after trim; error if empty
// 3. If --lines N: take last N lines
// 4. If not --no-redact: call redact(input); if result is empty, throw REDACTED_EMPTY
// 5. Call chunk(input) if over token estimate threshold
// 6. If --context: call buildContext(dir, input) → append to prompt
// 7. Load auth token from ~/.drill/config OR DRILL_API_KEY env var
// 8. Call api.analyze({ input, context, apiKey })
// 9. Stream: render.showThinking() for think chunks, render.showResult() on done
// 10. If --json: write result JSON to stdout
// 11. If --ci: process.exit(1) if result.confidence > 50
// 12. Show run count remaining if authenticated
```

## render.ts — terminal output spec

```typescript
// Colors (chalk):
//   thinking text: chalk.dim.gray
//   result box border: chalk.hex('#2D1B69')
//   cause text: chalk.white.bold
//   confidence HIGH(>75): chalk.green, MED(50-75): chalk.yellow, LOW(<50): chalk.red
//   severity CRITICAL: chalk.bgRed.white, HIGH: chalk.red, MEDIUM: chalk.yellow, LOW: chalk.blue
//   fix text: chalk.cyan
//   evidence: chalk.dim
//   error messages: chalk.red.bold

// Result box uses boxen with these options:
//   borderStyle: 'round'
//   borderColor: '#2D1B69'
//   padding: 1
//   title: 'DRILL'
//   titleAlignment: 'left'

// Live thinking output: prefix each line with chalk.dim('  ▸ ')
// Spinner: ora with text 'Drilling...' — stops before result renders
// Upgrade prompt: chalk.yellow box with upgrade URL
```

## api.ts — HTTP client spec

```typescript
// POST ${DRILL_API_URL}/api/analyze
// Body: { input: string, apiKey: string, version: '1.0', context?: string }
// Timeout: 90 seconds (configurable via --timeout)
// Streaming: fetch with ReadableStream, pipe to stream.ts parser
// Retry logic:
//   - On network error: retry once after 2s
//   - On 5xx: retry once with Together AI fallback URL
//   - On 429 (limit_reached): NO retry — emit upgrade prompt immediately
//   - On 401: NO retry — emit "invalid API key" error
// Error handling: all errors mapped to DrillError typed objects
```

## watch.ts — file watcher spec

```typescript
// drill --watch <filepath>
// Uses chokidar to tail the file
// Error detection regex: /\b(ERROR|FATAL|Exception|Traceback|panic|CRITICAL|SEVERE)\b/i
// On error line detected:
//   1. Wait 500ms (debounce — let burst write finish)
//   2. Read last 200 lines from file
//   3. Run same flow as run.ts with that content
//   4. Display result inline
//   5. Print separator and resume watching
// Rate limit: min 30 seconds between auto-analyses to prevent spam
// Ctrl+C: clean shutdown, show total analyses run in session
```

## context.ts — codebase context builder

```typescript
// drill --context ./src < error.log
// 1. Walk directory recursively (ignore: node_modules, .git, dist, build, *.lock)
// 2. Build file tree string (max depth 4)
// 3. Extract keywords from log input: function names, class names, file paths mentioned in stack trace
// 4. Score each source file by keyword match count
// 5. Include top 5 files by score, truncated to first 100 lines each
// 6. Format as context block appended to LLM prompt
// Max total context: 50k chars — truncate lowest-scored files first
```

## login.ts — auth flow spec

```typescript
// drill login
// 1. Generate a random state token (crypto.randomUUID())
// 2. Open browser: https://drill.dev/cli-auth?state={token}&device={hostname}
// 3. Poll GET /api/cli-auth/poll?state={token} every 2 seconds for up to 5 minutes
// 4. Response: { status: 'pending' | 'complete', apiKey?: string, plan?: string }
// 5. On complete: save to ~/.drill/config via `conf`
//    { apiKey, apiUrl: 'https://drill.dev', plan, runCount: 0, runLimit: 20 }
// 6. Show: "Authenticated as {email}. Plan: {plan}. {runLimit} runs/month."
```

## Anonymous mode (3 runs, no account)

```typescript
// Embedded in binary at build time via esbuild define:
//   __ANON_KEY__: process.env.DRILL_ANON_KEY (injected at build time)
//   __ANON_LIMIT__: '3'
// Stored in ~/.drill/config as anonRunsUsed: number
// When no apiKey in config and anonRunsUsed < 3: use __ANON_KEY__
// When anonRunsUsed >= 3: show "Sign up free at drill.dev to get 20 runs/month"
```

## build.ts — esbuild config

```typescript
import { build } from 'esbuild';
build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js',
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __ANON_KEY__: JSON.stringify(process.env.DRILL_ANON_KEY ?? ''),
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  external: ['fsevents'],  // macOS native module — exclude
  minify: true,
  sourcemap: false,
});
```

## package.json scripts

```json
{
  "scripts": {
    "build": "node build.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts"
  }
}
```
