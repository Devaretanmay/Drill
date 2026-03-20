/**
 * Integration Tests — Fixture Log Analysis
 * 
 * These tests call the REAL MiniMax M2.5 API.
 * They are SKIPPED by default in CI.
 * Run manually before releases with: DRILL_INTEGRATION=true DRILL_API_KEY=<key> pnpm test
 * 
 * Each fixture goes through the full pipeline:
 * redact → chunk → analyze → keyword validation
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { analyze } from '../../src/lib/api';
import { redact } from '../../src/lib/redact';
import { chunk } from '../../src/lib/chunk';

const FIXTURES_DIR = join(__dirname, '../fixtures');
const EXPECTED_DIR = join(FIXTURES_DIR, 'expected');

interface ExpectedOutput {
  confidenceMin: number;
  severityOneOf: string[];
  causeKeywords: string[];
  fixKeywords: string[];
  evidenceMustExist: boolean;
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

// Skip in CI unless explicitly enabled
const runIntegration = process.env['DRILL_INTEGRATION'] === 'true';
const describeOrSkip = runIntegration ? describe : describe.skip;

describeOrSkip('Integration: fixture log analysis', () => {
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.log'));

  for (const fixtureFile of fixtures) {
    const fixtureName = fixtureFile.replace('.log', '');
    const expectedFile = join(EXPECTED_DIR, `${fixtureName}.json`);

    it(`correctly analyzes: ${fixtureName}`, async () => {
      const input = readFileSync(join(FIXTURES_DIR, fixtureFile), 'utf8');
      const expected: ExpectedOutput = JSON.parse(
        readFileSync(expectedFile, 'utf8')
      ) as ExpectedOutput;

      // Apply full pipeline
      const redacted = redact(input);
      const chunked = chunk(redacted);
      const result = await analyze({
        input: chunked.content,
        timeoutMs: 90_000,
      });

      // Must not be an error
      expect(
        'code' in result,
        `Expected DrillResult but got DrillError: ${JSON.stringify(result)}`
      ).toBe(false);
      if ('code' in result) return; // type narrowing

      // Confidence must meet minimum (with 10% tolerance for non-determinism)
      expect(result.confidence).toBeGreaterThanOrEqual(expected.confidenceMin - 10);

      // Severity must be in allowed list
      expect(expected.severityOneOf).toContain(result.severity);

      // Cause must contain at least one keyword
      expect(
        matchesKeywords(result.cause, expected.causeKeywords),
        `Cause "${result.cause}" does not contain any of: ${expected.causeKeywords.join(', ')}`
      ).toBe(true);

      // Fix must contain at least one keyword
      expect(
        matchesKeywords(result.fix, expected.fixKeywords),
        `Fix "${result.fix}" does not contain any of: ${expected.fixKeywords.join(', ')}`
      ).toBe(true);

      // Evidence must exist if required
      if (expected.evidenceMustExist) {
        expect(result.evidence.length).toBeGreaterThan(0);
      }

      // Evidence must not contain PII (redaction check)
      for (const e of result.evidence) {
        expect(e).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // no email
        expect(e).not.toMatch(/eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+/); // no JWT
      }
    }, 120_000); // 2 min timeout per fixture
  }
});

describe('Integration: skipped by default', () => {
  it('integration tests run only when DRILL_INTEGRATION=true', () => {
    expect(runIntegration).toBe(false);
  });
});
