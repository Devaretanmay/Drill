import { createHash } from 'node:crypto';
import { getSupabase } from './supabase.js';

export function hashKey(apiKey: string): string {
  return createHash('sha256')
    .update(apiKey.trim())
    .digest('hex')
    .slice(0, 32);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

let _machineId: string | null = null;
export function getMachineId(): string {
  if (_machineId) return _machineId;
  try {
    const { machineIdSync } = require('node-machine-id') as { machineIdSync: (options: unknown) => string };
    _machineId = machineIdSync({ original: true });
  } catch {
    _machineId = '';
  }
  return _machineId ?? '';
}

export interface RegisterResult {
  success: true;
  plan: string;
  weekLimit: number;
}

export interface RegisterError {
  success: false;
  code: 'EMAIL_TAKEN' | 'KEY_TAKEN' | 'NETWORK' | 'INVALID_EMAIL';
  message: string;
}

export async function register(
  email: string,
  apiKey: string,
): Promise<RegisterResult | RegisterError> {
  if (!isValidEmail(email)) {
    return { success: false, code: 'INVALID_EMAIL', message: 'Invalid email address' };
  }

  const keyHash   = hashKey(apiKey);
  const machineId = getMachineId();

  try {
    const { error } = await getSupabase().from('users').insert({
      email:      email.trim().toLowerCase(),
      key_hash:   keyHash,
      machine_id: machineId,
    });

    if (error) {
      if (error.code === '23505') {
        if (error.message.toLowerCase().includes('email')) {
          return {
            success: false,
            code: 'EMAIL_TAKEN',
            message: 'This email is already registered. Run: drill status',
          };
        }
        if (error.message.toLowerCase().includes('key_hash')) {
          return {
            success: false,
            code: 'KEY_TAKEN',
            message: 'This API key is already registered to another account.',
          };
        }
      }
      throw error;
    }

    return { success: true, plan: 'free', weekLimit: 100 };

  } catch (e: unknown) {
    return {
      success: false,
      code: 'NETWORK',
      message: e instanceof Error ? e.message : 'Could not reach database',
    };
  }
}

export interface CheckResult {
  allowed: boolean;
  registered: boolean;
  runsWeek: number;
  limit: number;
  plan: string;
}

export async function checkAndCount(apiKey: string): Promise<CheckResult> {
  const keyHash = hashKey(apiKey);

  try {
    const { data, error } = await getSupabase()
      .rpc('increment_run_count', { p_key_hash: keyHash });

    if (error) throw error;

    const result = data as {
      found: boolean;
      runs_week: number;
      plan: string;
      limit: number;
      over_limit: boolean;
    };

    if (!result.found) {
      return {
        allowed:    false,
        registered: false,
        runsWeek:   0,
        limit:      100,
        plan:       'free',
      };
    }

    return {
      allowed:    !result.over_limit,
      registered: true,
      runsWeek:   result.runs_week,
      limit:      result.limit,
      plan:       result.plan,
    };

  } catch {
    return {
      allowed:    true,
      registered: true,
      runsWeek:   0,
      limit:      100,
      plan:       'free',
    };
  }
}

export interface StatusData {
  found: boolean;
  email?: string;
  plan?: string;
  runsWeek?: number;
  weekReset?: string;
  limit?: number;
}

export async function getStatus(apiKey: string): Promise<StatusData> {
  const keyHash = hashKey(apiKey);

  try {
    const { data } = await getSupabase()
      .from('users')
      .select('email, plan, runs_week, week_reset')
      .eq('key_hash', keyHash)
      .single();

    if (!data) return { found: false };

    return {
      found:     true,
      email:     data.email,
      plan:      data.plan,
      runsWeek:  data.runs_week,
      weekReset: data.week_reset,
      limit:     data.plan === 'free' ? 100 : 999999,
    };
  } catch {
    return { found: false };
  }
}
