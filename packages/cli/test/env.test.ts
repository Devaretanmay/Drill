import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../src/lib/env';

describe('env', () => {
  const originalEnv = { ...process.env };
  
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  
  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns validated env with defaults when no env vars set', () => {
    delete process.env['DRILL_API_URL'];
    delete process.env['DRILL_FALLBACK_URL'];
    delete process.env['DRILL_FALLBACK_KEY'];
    delete process.env['DRILL_MODEL'];
    delete process.env['DRILL_FALLBACK_MODEL'];
    
    const env = validateEnv();
    
    expect(env.DRILL_API_URL).toBe('https://api.drill.dev');
    expect(env.DRILL_FALLBACK_URL).toBe('https://api.together.xyz/v1');
    expect(env.DRILL_FALLBACK_KEY).toBe('');
    expect(env.DRILL_MODEL).toBe('MiniMax-M2.5');
    expect(env.DRILL_FALLBACK_MODEL).toBe('MiniMaxAI/MiniMax-M2.5');
  });

  it('uses custom values when env vars are set', () => {
    process.env['DRILL_API_URL'] = 'https://custom.api/v1';
    process.env['DRILL_FALLBACK_URL'] = 'https://custom.fallback/v1';
    process.env['DRILL_FALLBACK_KEY'] = 'fallback-key';
    process.env['DRILL_MODEL'] = 'custom-model';
    process.env['DRILL_FALLBACK_MODEL'] = 'custom-fallback-model';
    
    const env = validateEnv();
    
    expect(env.DRILL_API_URL).toBe('https://custom.api/v1');
    expect(env.DRILL_FALLBACK_URL).toBe('https://custom.fallback/v1');
    expect(env.DRILL_FALLBACK_KEY).toBe('fallback-key');
    expect(env.DRILL_MODEL).toBe('custom-model');
    expect(env.DRILL_FALLBACK_MODEL).toBe('custom-fallback-model');
  });

  it('exits with error on invalid URL format', () => {
    process.env['DRILL_API_URL'] = 'not-a-url';
    
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    
    validateEnv();
    
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
