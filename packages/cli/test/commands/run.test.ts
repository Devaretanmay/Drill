import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCommand } from '../../src/commands/run';

vi.mock('../../src/lib/auth', () => ({
  loadAuth: vi.fn().mockReturnValue({
    apiKey: 'test-key',
    apiUrl: 'https://api.minimax.io/v1',
    provider: 'minimax',
    providerModel: 'MiniMax-M2.5',
    localModel: undefined,
    redact: true,
    customUrl: undefined,
  }),
  getApiKey: vi.fn().mockReturnValue('test-key'),
  getApiUrl: vi.fn().mockReturnValue('https://api.minimax.io/v1'),
}));

vi.mock('../../src/lib/context', () => ({
  buildContext: vi.fn().mockResolvedValue('# Context: test file'),
}));

vi.mock('../../src/lib/api', () => ({
  analyze: vi.fn().mockResolvedValue({
    cause: 'Database connection pool exhausted',
    confidence: 87,
    severity: 'high',
    evidence: ['Too many connections at 14:07'],
    fix: 'Increase DB_POOL_SIZE to 25',
    alternative: null,
    missing: null,
  }),
}));

vi.mock('../../src/lib/render', () => ({
  showThinking: vi.fn(),
  showResult: vi.fn(),
  showError: vi.fn(),
  showInputInfo: vi.fn(),
  showRedactStats: vi.fn(),
  clearThinking: vi.fn(),
}));

describe('runCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes inline input argument', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('Error: connection refused', {});
    expect(analyze).toHaveBeenCalledOnce();
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('Error: connection refused');
  });

  it('applies redaction by default', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('user@test.com failed at 192.168.1.1', {});
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).not.toContain('user@test.com');
    expect(callArg.input).not.toContain('192.168.1.1');
    expect(callArg.input).toContain('[EMAIL]');
    expect(callArg.input).toContain('[IP]');
  });

  it('skips redaction with --no-redact', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('user@test.com error', { noRedact: true });
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('user@test.com');
  });

  it('limits lines with --lines flag', async () => {
    const { analyze } = await import('../../src/lib/api');
    const input = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    await runCommand(input, { lines: '10' });
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('line 99');
  });

  it('exits 1 with invalid --lines value', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test', { lines: 'abc' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits 1 with --lines value of 0', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test', { lines: '0' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('exits 1 with invalid --timeout value', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test', { timeout: '-5' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('outputs JSON with --json flag', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runCommand('test error', { json: true });
    const written = writeSpy.mock.calls.map(c => c[0] as string).join('');
    const parsed = JSON.parse(written);
    expect(parsed.cause).toBe('Database connection pool exhausted');
    writeSpy.mockRestore();
  });

  it('exits process 1 in --ci mode for high severity', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('does not exit in --ci mode for low severity', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cause: 'Unknown',
      confidence: 30,
      severity: 'low',
      evidence: [],
      fix: 'Investigate further',
      alternative: null,
      missing: 'More logs needed',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('exits process 1 in --ci mode for critical severity', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cause: 'Service down',
      confidence: 90,
      severity: 'critical',
      evidence: [],
      fix: 'Restart the service',
      alternative: null,
      missing: null,
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('does not exit in --ci mode for medium severity', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cause: 'Degraded performance',
      confidence: 70,
      severity: 'medium',
      evidence: [],
      fix: 'Check resource usage',
      alternative: null,
      missing: null,
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { ci: true });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('shows error and exits 1 on DrillError (non-limit)', async () => {
    const { analyze } = await import('../../src/lib/api');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 'NETWORK',
      message: 'Connection failed',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', {});
    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('shows error and exits 2 on LIMIT_REACHED', async () => {
    const { analyze } = await import('../../src/lib/api');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 'LIMIT_REACHED',
      message: 'Run limit reached',
      upgrade_url: 'https://drill.dev/upgrade',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', {});
    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(2);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('shows error and exits 1 on TIMEOUT error', async () => {
    const { analyze } = await import('../../src/lib/api');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 'TIMEOUT',
      message: 'Request timed out',
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', {});
    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('outputs JSON with error on DrillError in --json mode', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      code: 'PARSE_FAILED',
      message: 'Parse failed',
    });
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { json: true });
    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('shows redaction stats in verbose mode', async () => {
    const { showRedactStats } = await import('../../src/lib/render');
    await runCommand('user@test.com error', { verbose: true });
    expect(showRedactStats).toHaveBeenCalled();
  });

  it('passes context option to analyze', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('test error', { context: '/src/services' });
    expect(analyze).toHaveBeenCalledOnce();
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toHaveProperty('context');
  });

  it('passes timeout option to analyze', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('test error', { timeout: '120' });
    expect(analyze).toHaveBeenCalledOnce();
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.timeoutMs).toBe(120000);
  });

  it('routes local runs to Ollama and applies model override', async () => {
    const { analyze } = await import('../../src/lib/api');
    await runCommand('test error', { local: true, model: 'qwen2.5:latest' });
    expect(analyze).toHaveBeenCalledOnce();
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.providerOverride).toBe('ollama');
    expect(callArg.providerModelOverride).toBe('qwen2.5:latest');
  });

  it('exits when --model is used without --local', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', { model: 'qwen2.5:latest' });
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('passes --no-redact through to preprocessing', async () => {
    const { analyze } = await import('../../src/lib/api');
    (analyze as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      cause: 'Test',
      confidence: 50,
      severity: 'low',
      evidence: [],
      fix: 'Test fix',
      alternative: null,
      missing: null,
    });
    await runCommand('user@test.com error', { noRedact: true });
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('user@test.com');
  });

  it('passes deduped content to analyze — repeated lines collapsed', async () => {
    const repeatedLog = Array(20).fill('ERROR: ECONNREFUSED 127.0.0.1:5432').join('\n');
    const { analyze } = await import('../../src/lib/api');
    await runCommand(repeatedLog, {});
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('[×20]');
    expect(callArg.input.split('\n').length).toBe(1);
  });

  it('passes filtered content to analyze — INFO spam removed', async () => {
    const noisyLog = [
      ...Array(50).fill('INFO: health check ok'),
      'ERROR: database connection refused',
      ...Array(50).fill('INFO: health check ok'),
    ].join('\n');
    const { analyze } = await import('../../src/lib/api');
    await runCommand(noisyLog, {});
    const callArg = (analyze as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.input).toContain('ERROR: database connection refused');
    const infoCount = callArg.input.split('\n')
      .filter((l: string) => l.startsWith('INFO: health')).length;
    expect(infoCount).toBeLessThan(10);
  });

  it('exits 1 when no API key and not local', async () => {
    const { getApiKey } = await import('../../src/lib/auth');
    (getApiKey as ReturnType<typeof vi.fn>).mockReturnValueOnce('');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('test error', {});
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('does not exit on partial redaction (input still has content)', async () => {
    const { analyze } = await import('../../src/lib/api');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await runCommand('AKIAIOSFODNN7EXAMPLE is an error', {});
    expect(exitSpy).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});
