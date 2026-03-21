import { createClient, SupabaseClient } from '@supabase/supabase-js';

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON__: string;

const url  = typeof __SUPABASE_URL__  !== 'undefined' ? __SUPABASE_URL__  : (process.env['SUPABASE_URL']       ?? '');
const anon = typeof __SUPABASE_ANON__ !== 'undefined' ? __SUPABASE_ANON__ : (process.env['SUPABASE_ANON_KEY'] ?? '');

let _supabase: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_supabase) {
    if (!url || !anon) {
      throw new Error('Supabase credentials not configured.');
    }
    _supabase = createClient(url, anon, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _supabase;
}

export const supabase = new Proxy({} as any, {
  get(_target, prop) {
    const client = getClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});

export function authedClient(token: string): SupabaseClient {
  if (!url || !anon) {
    throw new Error('Supabase credentials not configured.');
  }
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
