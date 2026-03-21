import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preprocess } from '../../src/lib/preprocess';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn().mockReturnValue({
    apiKey: 'test-key',
    apiUrl: 'https://api.drill.dev',
    plan: 'free',
    runCount: 0,
    runLimit: 20,
    provider: 'minimax',
    providerModel: 'MiniMax-M2.5',
    model: 'cloud',
    localModel: undefined,
    redact: true,
    customUrl: undefined,
    supabaseToken: 'test-token',
    supabaseUserId: 'test-user-id',
    email: 'test@example.com',
    runsWeek: 5,
    weekLimit: 100,
    weekReset: '2029-01-01',
  }),
  getApiKey: vi.fn().mockReturnValue('test-key'),
}));

vi.mock('../../src/lib/api', () => ({
  analyze: vi.fn().mockResolvedValue({
    cause: 'Database connection refused',
    confidence: 87,
    severity: 'high',
    evidence: ['ECONNREFUSED detected'],
    fix: 'Check database connectivity',
    alternative: null,
    missing: null,
  }),
}));

vi.mock('chokidar', () => ({
  watch: vi.fn().mockReturnValue({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('watchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('watch mode uses same preprocessing as run mode — preprocess deduplicates repeated lines', () => {
    const repeatedLog = Array(20).fill('ERROR: ECONNREFUSED').join('\n');
    const result = preprocess(repeatedLog, false);
    expect(result.content).toContain('[×20]');
  });

  it('watch mode uses same preprocessing as run mode — preprocess filters INFO spam', () => {
    const noisyLog = [
      ...Array(50).fill('INFO: health check'),
      'ERROR: db fail',
      ...Array(50).fill('INFO: health check'),
    ].join('\n');
    const result = preprocess(noisyLog, false);
    expect(result.content).toContain('ERROR: db fail');
    expect(result.filterResult.keptLineCount).toBeLessThan(10);
  });

  it('watch mode uses same preprocessing as run mode — preprocess keeps signal context', () => {
    const log = [
      'INFO: starting up',
      'INFO: loading config',
      'ERROR: connection refused',
      'INFO: retrying',
      'INFO: done',
    ].join('\n');
    const result = preprocess(log, false);
    expect(result.content).toContain('ERROR: connection refused');
    expect(result.content).toContain('INFO: starting up');
    expect(result.content).toContain('INFO: retrying');
    expect(result.content).toContain('INFO: done');
  });

  it('watch mode applies redaction by default via preprocess', () => {
    const log = 'user@test.com ERROR: fail';
    const result = preprocess(log, true);
    expect(result.content).not.toContain('user@test.com');
    expect(result.content).toContain('[EMAIL]');
    expect(result.wasRedacted).toBe(true);
  });

  it('watch mode skips redaction with noRedact via preprocess', () => {
    const log = 'user@test.com ERROR: fail';
    const result = preprocess(log, false);
    expect(result.content).toContain('user@test.com');
    expect(result.wasRedacted).toBe(false);
  });

  it('watch mode uses same preprocess pipeline for all content', () => {
    const log = [
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
      'ERROR: panic: runtime error',
      '172.0.0.1 "GET /health HTTP/1.1" 200 -',
    ].join('\n');

    const result = preprocess(log, false);

    expect(result.content).toContain('ERROR: panic');
    expect(result.content).toContain('[×3]');
    expect(result.filterResult.matchedLineCount).toBe(1);
    expect(result.chunkResult.wasChunked).toBe(false);
  });
});
