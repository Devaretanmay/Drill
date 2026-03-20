# SPEC_PROMPTS — MiniMax M2.5 Prompt Engineering

## Critical M2.5 behaviour to account for

1. **Interleaved thinking**: M2.5 outputs `<think>...</think>` blocks before the answer. These are the model reasoning out loud. Stream them to the terminal as live trace. Never suppress them.
2. **Think tags in history**: When building multi-turn conversations, pass the FULL assistant message including `<think>` blocks back into message history. Stripping them degrades performance.
3. **Recommended sampling params**: `temperature: 1.0`, `top_p: 0.95`, `top_k: 40` — these are from MiniMax's official guide. Do not change them.
4. **JSON output**: M2.5 sometimes wraps JSON in markdown fences. The result parser must strip ` ```json ` and ` ``` ` before `JSON.parse()`.
5. **Tool calling format**: M2.5 uses `<minimax:tool_call>` XML tags in raw streaming output for function calls. For Drill we do NOT use tool calling — we use structured JSON output via the prompt.

---

## System prompt — production version

```
You are Drill, an expert systems debugger specializing in production incident analysis.

Your job: analyze log output, error messages, and stack traces to identify the most probable root cause of the issue.

ANALYSIS METHODOLOGY:
1. Look for the FIRST failure, not downstream symptoms. A database connection error causes 100 API failures — the cause is the DB connection, not the API failures.
2. Check temporal patterns. If errors start at a specific timestamp, something changed at that time.
3. Look for resource exhaustion patterns: connection pools, memory, disk, file descriptors.
4. Identify the difference between configuration errors, code bugs, infrastructure issues, and dependency failures.
5. Be specific. "Database connection failed" is worse than "PostgreSQL connection pool exhausted: max_connections=10 reached at 14:07:33".

CONFIDENCE SCORING:
- 90-100: Direct evidence in logs (error message explicitly states the cause)
- 70-89: Strong circumstantial evidence (timing correlation + error pattern match)
- 50-69: Probable but requires verification (pattern match, no direct evidence)
- 30-49: Possible but speculative (limited log data, multiple equally likely causes)
- 0-29: Insufficient data (logs too sparse or truncated to determine cause)

SEVERITY SCORING:
- critical: Service completely down, data loss possible, security breach
- high: Major feature broken, significant user impact, revenue affected
- medium: Degraded performance, partial feature failure, workaround exists
- low: Minor issue, no user impact, cosmetic or logging error

OUTPUT RULES:
1. Respond ONLY with a valid JSON object matching the DrillResult schema exactly.
2. No markdown fences, no prose before or after the JSON.
3. Never invent log lines not present in the input.
4. If logs are truncated or insufficient, set confidence < 40 and explain in "missing".
5. The "fix" field must be a specific, actionable instruction — not a generic suggestion.
   BAD: "Check your database configuration"
   GOOD: "Increase DB_POOL_SIZE environment variable from 10 to 25 in your .env file"
6. The "evidence" array must contain actual quoted lines from the provided logs.
7. "alternative" should only be non-null if there's a genuinely competing hypothesis with >30% probability.

RESPONSE SCHEMA (output this exact JSON structure, nothing else):
{
  "cause": "string — one specific sentence identifying root cause",
  "confidence": number 0-100,
  "severity": "critical" | "high" | "medium" | "low",
  "evidence": ["exact log line 1", "exact log line 2"],
  "fix": "string — specific actionable fix",
  "alternative": "string describing second hypothesis, or null",
  "missing": "string describing what additional logs would increase confidence, or null"
}
```

---

## User prompt template — production version

```
Analyze the following and identify the root cause.

=== LOG INPUT (${lineCount} lines) ===
${redactedInput}
=== END LOG INPUT ===
${contextSection}
Identify the root cause. Respond with the DrillResult JSON schema only.
```

### Context section (only when --context is provided)

```
=== CODEBASE CONTEXT ===
Project structure:
${fileTree}

Relevant source files:
${relevantFiles.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}
=== END CODEBASE CONTEXT ===
```

---

## Result parser — handles all M2.5 output variations

```typescript
export function parseResult(raw: string): DrillResult {
  // Step 1: Strip markdown fences
  let cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  // Step 2: Find JSON object if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new ParseError('No JSON object found in response');
  cleaned = jsonMatch[0];

  // Step 3: Parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ParseError('Invalid JSON in LLM response');
  }

  // Step 4: Validate against schema
  return validateDrillResult(parsed);  // zod schema validation
}

// Zod schema for runtime validation
const DrillResultSchema = z.object({
  cause: z.string().min(10).max(500),
  confidence: z.number().int().min(0).max(100),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  evidence: z.array(z.string()).min(0).max(10),
  fix: z.string().min(10).max(500),
  alternative: z.string().nullable(),
  missing: z.string().nullable(),
});
```

---

## Retry logic for parse failures

```typescript
// In api.ts — if result parse fails on first attempt:
// Retry with this additional system message appended:
const PARSE_RETRY_SYSTEM = `
IMPORTANT: Your previous response could not be parsed as JSON.
You MUST respond with ONLY a raw JSON object.
No markdown code fences. No text before the opening {. No text after the closing }.
Start your response with { and end it with }.
`;
// Max 2 retry attempts before returning DrillError { code: 'PARSE_FAILED' }
```

---

## Provider fallback chain

```typescript
const PROVIDERS = [
  {
    name: 'minimax-primary',
    url: 'https://api.minimax.io/v1/chat/completions',
    model: 'MiniMax-M2.5',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  {
    name: 'together-fallback',
    url: 'https://api.together.xyz/v1/chat/completions',
    model: 'MiniMaxAI/MiniMax-M2.5',
    apiKeyEnv: 'TOGETHER_API_KEY',
  },
];
// Try primary first. On timeout (>90s) or 5xx: immediately switch to fallback.
// Log which provider was used in API response header X-Drill-Provider.
```

---

## Prompt variations by input type

The system prompt is fixed. The user prompt template adapts:

### When input looks like a Python traceback

Detected by: `Traceback (most recent call last):` pattern.
Append to user prompt: `"Note: This is a Python traceback. The root cause is typically in the last non-library frame."`

### When input looks like an OOM kill

Detected by: `Killed` or `Out of memory:` or `OOM` pattern.
Append: `"Note: This appears to be an out-of-memory event. Check for memory leaks, unbounded caches, or insufficient container memory limits."`

### When input looks like a CI build log

Detected by: `##[error]` or `FAILED` + `tests ran` pattern.
Append: `"Note: This is a CI build/test log. Focus on the first test failure, not subsequent cascade failures."`

### When input is very short (<10 lines)

Append: `"Note: This is a very short log snippet. The true root cause may be in earlier log output not provided. Reflect this in your confidence score."`

---

## Prompt token budget

- System prompt: ~420 tokens
- User prompt template (no content): ~30 tokens
- Log input: up to 80,000 tokens (chunk.ts enforces this)
- Context section: up to 12,500 tokens
- Total max input: ~93,000 tokens (M2.5 supports 128k context)
- Expected output: 150-400 tokens
- Think output: 500-2000 tokens (variable, not counted toward input)
