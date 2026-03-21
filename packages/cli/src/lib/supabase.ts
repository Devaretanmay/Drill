import { createClient, type SupabaseClient } from '@supabase/supabase-js';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_KEY__: string;

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;

  const url = typeof __SUPABASE_URL__ === 'string' && __SUPABASE_URL__.length > 0
    ? __SUPABASE_URL__
    : (process.env['SUPABASE_URL'] ?? '');

  const key = typeof __SUPABASE_KEY__ === 'string' && __SUPABASE_KEY__.length > 0
    ? __SUPABASE_KEY__
    : (process.env['SUPABASE_SERVICE_KEY'] ?? '');

  if (!url || !key) {
    throw new Error('Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables, or rebuild with these values injected via build.mjs.');
  }

  _supabase = createClient(url, key);
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
