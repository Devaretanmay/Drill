import { describe, it, expect } from 'vitest';
import { buildUserPrompt, parseResult, detectInputType, SYSTEM_PROMPT, PARSE_RETRY_SUFFIX, ParseError } from '../src/lib/prompts';

describe('detectInputType', () => {
  it('detects python tracebacks', () => {
    expect(detectInputType('Traceback (most recent call last):\n  File')).toBe('python-traceback');
  });

  it('detects OOM events', () => {
    expect(detectInputType('Out of memory: Kill process 1234')).toBe('oom-kill');
  });

  it('detects CI build logs', () => {
    expect(detectInputType('##[error] Process failed\nFAILED 3 tests ran')).toBe('ci-build');
  });

  it('detects short inputs', () => {
    expect(detectInputType('just one error line')).toBe('short');
  });

  it('defaults to general', () => {
    expect(detectInputType('normal log line\nanother line\n'.repeat(20))).toBe('general');
  });

  it('detects OOM killer events', () => {
    expect(detectInputType('Killed')).toBe('oom-kill');
  });
});

describe('buildUserPrompt', () => {
  it('includes line count', () => {
    const prompt = buildUserPrompt('line1\nline2\nline3');
    expect(prompt).toContain('3 lines');
  });

  it('includes the log input', () => {
    const prompt = buildUserPrompt('ERROR: connection refused');
    expect(prompt).toContain('ERROR: connection refused');
  });

  it('includes context section when provided', () => {
    const prompt = buildUserPrompt('error log', 'function main() {}');
    expect(prompt).toContain('CODEBASE CONTEXT');
    expect(prompt).toContain('function main()');
  });

  it('omits context section when not provided', () => {
    const prompt = buildUserPrompt('error log');
    expect(prompt).not.toContain('CODEBASE CONTEXT');
  });

  it('appends python traceback hint for python logs', () => {
    const prompt = buildUserPrompt('Traceback (most recent call last):\n  File "app.py"');
    expect(prompt).toContain('Python traceback');
  });

  it('includes log input markers', () => {
    const prompt = buildUserPrompt('test log');
    expect(prompt).toContain('=== LOG INPUT ===');
    expect(prompt).toContain('=== END LOG INPUT ===');
  });

  it('includes response instruction', () => {
    const prompt = buildUserPrompt('test log');
    expect(prompt).toContain('DrillResult JSON schema only');
  });

  it('includes git diff block when provided', () => {
    const gitBlock = '=== GIT CONTEXT ===\nCommit: abc1234\nChanged files: UserService.java\n\nDiff:\n-old\n+new\n=== END GIT CONTEXT ===';
    const prompt = buildUserPrompt('error log', undefined, gitBlock);
    expect(prompt).toContain('GIT CONTEXT');
    expect(prompt).toContain('abc1234');
  });

  it('omits git diff block when not provided', () => {
    const prompt = buildUserPrompt('error log');
    expect(prompt).not.toContain('GIT CONTEXT');
  });

  it('includes meta block when provided', () => {
    const prompt = buildUserPrompt('error log', undefined, undefined, 'env=prod');
    expect(prompt).toContain('ADDITIONAL CONTEXT');
    expect(prompt).toContain('env=prod');
  });

  it('omits meta block when not provided', () => {
    const prompt = buildUserPrompt('error log');
    expect(prompt).not.toContain('ADDITIONAL CONTEXT');
  });

  it('places git diff before meta in prompt', () => {
    const prompt = buildUserPrompt('error log', undefined, 'git content', 'meta content');
    expect(prompt.indexOf('GIT CONTEXT')).toBeLessThan(prompt.indexOf('ADDITIONAL CONTEXT'));
  });

  it('includes all three sources when provided', () => {
    const gitBlock = '=== GIT CONTEXT ===\nCommit: abc123\nChanged files: foo.js\n=== END GIT CONTEXT ===';
    const prompt = buildUserPrompt('ERROR: null', 'const x = 1', gitBlock, 'env=prod');
    expect(prompt).toContain('ERROR: null');
    expect(prompt).toContain('CODEBASE CONTEXT');
    expect(prompt).toContain('GIT CONTEXT');
    expect(prompt).toContain('ADDITIONAL CONTEXT');
    expect(prompt).toContain('const x = 1');
    expect(prompt).toContain('foo.js');
    expect(prompt).toContain('env=prod');
  });
});

describe('parseResult', () => {
  const validResult = {
    cause: 'Database connection pool exhausted',
    confidence: 87,
    severity: 'high',
    evidence: ['Too many connections at 14:07'],
    fix: 'Increase DB_POOL_SIZE to 25',
    alternative: null,
    missing: null,
  };

  it('parses valid JSON', () => {
    const result = parseResult(JSON.stringify(validResult));
    expect(result.cause).toBe('Database connection pool exhausted');
    expect(result.confidence).toBe(87);
  });

  it('strips markdown fences', () => {
    const result = parseResult('```json\n' + JSON.stringify(validResult) + '\n```');
    expect(result.confidence).toBe(87);
  });

  it('extracts JSON from surrounding prose', () => {
    const result = parseResult('Here is my analysis:\n' + JSON.stringify(validResult) + '\nThat is the cause.');
    expect(result.cause).toBe('Database connection pool exhausted');
  });

  it('throws ParseError for invalid JSON', () => {
    expect(() => parseResult('not json at all')).toThrow(ParseError);
  });

  it('throws ParseError for JSON failing schema validation', () => {
    expect(() => parseResult('{"cause": "x"}')).toThrow();
  });

  it('validates severity enum', () => {
    const invalid = { ...validResult, severity: 'extreme' };
    expect(() => parseResult(JSON.stringify(invalid))).toThrow();
  });

  it('validates confidence range', () => {
    const invalid = { ...validResult, confidence: 150 };
    expect(() => parseResult(JSON.stringify(invalid))).toThrow();
  });

  it('validates evidence as array', () => {
    const invalid = { ...validResult, evidence: 'not an array' };
    expect(() => parseResult(JSON.stringify(invalid))).toThrow();
  });

  it('accepts valid alternative and missing strings', () => {
    const result = parseResult(JSON.stringify({
      ...validResult,
      alternative: 'Second possible cause',
      missing: 'Stack trace would help',
    }));
    expect(result.alternative).toBe('Second possible cause');
    expect(result.missing).toBe('Stack trace would help');
  });

  it('trims whitespace before parsing', () => {
    const result = parseResult('   ' + JSON.stringify(validResult) + '   ');
    expect(result.confidence).toBe(87);
  });
});

describe('SYSTEM_PROMPT', () => {
  it('contains confidence scoring rules', () => {
    expect(SYSTEM_PROMPT).toContain('90-100');
    expect(SYSTEM_PROMPT).toContain('Direct evidence');
  });

  it('contains schema definition', () => {
    expect(SYSTEM_PROMPT).toContain('"cause"');
    expect(SYSTEM_PROMPT).toContain('"confidence"');
    expect(SYSTEM_PROMPT).toContain('"severity"');
  });

  it('instructs JSON-only output', () => {
    expect(SYSTEM_PROMPT).toContain('Start your response with {');
  });

  it('contains severity levels', () => {
    expect(SYSTEM_PROMPT).toContain('critical');
    expect(SYSTEM_PROMPT).toContain('high');
    expect(SYSTEM_PROMPT).toContain('medium');
    expect(SYSTEM_PROMPT).toContain('low');
  });
});

describe('PARSE_RETRY_SUFFIX', () => {
  it('contains CRITICAL instruction', () => {
    expect(PARSE_RETRY_SUFFIX).toContain('CRITICAL');
  });

  it('instructs raw JSON only', () => {
    expect(PARSE_RETRY_SUFFIX).toContain('raw JSON object');
  });

  it('warns against markdown', () => {
    expect(PARSE_RETRY_SUFFIX).toContain('No markdown');
  });
});
