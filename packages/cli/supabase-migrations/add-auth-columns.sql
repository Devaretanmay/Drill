-- Run this in: Supabase SQL Editor

-- Add columns for auth tracking
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS machine_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS key_hash TEXT;

-- Allow anon inserts (for new user registration)
DROP POLICY IF EXISTS "users_insert_anon" ON public.users;
CREATE POLICY "users_insert_anon" ON public.users FOR INSERT WITH CHECK (true);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
