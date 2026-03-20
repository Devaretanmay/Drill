/**
 * Prompt Engineering Module
 * 
 * Handles system prompt, user prompt building, and LLM response parsing.
 * All prompts are designed for MiniMax M2.5's thinking capabilities.
 */

import { z } from 'zod';
import type { DrillResult } from '../types.js';

export const SYSTEM_PROMPT = `You are Drill, an expert systems debugger specializing in production incident analysis.

Your job: analyze log output, error messages, and stack traces to identify the most probable root cause.

ANALYSIS METHODOLOGY:
1. Look for the FIRST failure, not downstream symptoms. A database connection error causing 100 API failures — the cause is the DB connection, not the API failures.
2. Check temporal patterns. Errors starting at a specific timestamp mean something changed at that time.
3. Look for resource exhaustion: connection pools, memory, disk, file descriptors, thread limits.
4. Identify the category: configuration error, code bug, infrastructure failure, or dependency failure.
5. Be specific. "Database connection failed" is worse than "PostgreSQL pool exhausted: max_connections=10 reached at 14:07:33".

CONFIDENCE SCORING:
- 90-100: Direct evidence (error message explicitly states the cause)
- 70-89: Strong circumstantial (timing correlation + clear error pattern)
- 50-69: Probable but needs verification (pattern match, no direct evidence)
- 30-49: Possible but speculative (limited data, multiple equally likely causes)
- 0-29: Insufficient data (logs too sparse or truncated)

SEVERITY SCORING:
- critical: Service completely down, data loss possible, security breach
- high: Major feature broken, significant user impact
- medium: Degraded performance, partial failure, workaround exists
- low: Minor issue, no user impact

OUTPUT RULES:
1. Respond ONLY with a valid JSON object matching the schema below. No markdown fences. No prose before or after.
2. Never invent log lines not present in the input.
3. If logs are insufficient, set confidence below 40 and explain in "missing".
4. "fix" must be specific and actionable — never generic.
5. "evidence" must contain actual quoted lines from the input.
6. Start your response with { and end with }. Nothing else.

RESPONSE SCHEMA:
{
  "cause": "one specific sentence identifying root cause",
  "confidence": 0-100,
  "severity": "critical" | "high" | "medium" | "low",
  "evidence": ["exact log line 1", "exact log line 2"],
  "fix": "specific actionable fix instruction",
  "alternative": "second hypothesis or null",
  "missing": "what additional logs would help or null"
}`;

export type InputType = 'python-traceback' | 'oom-kill' | 'ci-build' | 'short' | 'general';

/**
 * Detects the type of log input to append type-specific hints to the prompt.
 * @param input Redacted log string
 * @returns Detected input type
 */
export function detectInputType(input: string): InputType {
  if (/Traceback \(most recent call last\)/i.test(input)) return 'python-traceback';
  if (/Out of memory:|OOM killer|Killed\s*$/im.test(input)) return 'oom-kill';
  if (/##\[error\]|FAILED.*tests ran|npm ERR! Test failed/i.test(input)) return 'ci-build';
  if (input.split('\n').length < 10) return 'short';
  return 'general';
}

const TYPE_HINTS: Record<InputType, string> = {
  'python-traceback': 'Note: This is a Python traceback. The root cause is in the last non-library frame before the exception.',
  'oom-kill': 'Note: This is an out-of-memory event. Focus on: container memory limit, memory growth pattern, and the process that was killed.',
  'ci-build': 'Note: This is a CI build/test log. Focus on the FIRST failure — ignore cascade failures after it.',
  'short': 'Note: This is a very short log snippet. The root cause may be in earlier logs not provided. Reflect this in confidence score.',
  'general': '',
};

/**
 * Builds the user prompt message for M2.5.
 * @param input Redacted, chunked log string
 * @param context Optional codebase context string
 * @returns Formatted user message string
 */
export function buildUserPrompt(input: string, context?: string): string {
  const lineCount = input.split('\n').length;
  const inputType = detectInputType(input);
  const typeHint = TYPE_HINTS[inputType];

  const contextSection = context
    ? `\n=== CODEBASE CONTEXT ===\n${context}\n=== END CODEBASE CONTEXT ===\n`
    : '';

  const hintSection = typeHint ? `\n${typeHint}\n` : '';

  return [
    `Analyze the following and identify the root cause. (${lineCount} lines)`,
    '',
    '=== LOG INPUT ===',
    input,
    '=== END LOG INPUT ===',
    contextSection,
    hintSection,
    'Respond with the DrillResult JSON schema only.',
  ].filter((s): s is string => s !== undefined).join('\n');
}

export const DrillResultSchema = z.object({
  cause: z.string().min(10, 'Cause too short').max(500, 'Cause too long'),
  confidence: z.number().int().min(0).max(100),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  evidence: z.array(z.string()).min(0).max(10),
  fix: z.string().min(5, 'Fix too short').max(500, 'Fix too long'),
  alternative: z.string().nullable(),
  missing: z.string().nullable(),
});

export class ParseError extends Error {
  readonly name = 'ParseError';
}

/**
 * Parses the raw LLM response string into a typed DrillResult.
 * Handles: JSON wrapped in markdown fences, leading/trailing prose,
 * partial JSON objects. Uses Zod for runtime validation.
 * @param raw Raw string from LLM (complete, not streaming)
 * @returns Validated DrillResult
 * @throws ParseError if JSON cannot be extracted or fails schema validation
 */
export function parseResult(raw: string): DrillResult {
  let cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new ParseError(`No JSON object found. Raw response: ${cleaned.slice(0, 200)}`);
  }
  cleaned = jsonMatch[0];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown parse error';
    throw new ParseError(`Invalid JSON: ${msg}. Content: ${cleaned.slice(0, 200)}`);
  }

  const result = DrillResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`Schema validation failed: ${result.error.message}`);
  }

  return result.data;
}

export const PARSE_RETRY_SUFFIX = `\n\nCRITICAL: Your previous response could not be parsed as JSON. You MUST respond with ONLY a raw JSON object. Start with { and end with }. No markdown. No explanation. Just the JSON object.`;
