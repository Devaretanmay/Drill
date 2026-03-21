-- Add insert policy so CLI can create user records without service role
CREATE POLICY "users_insert_anon" ON public.users
  FOR INSERT WITH CHECK (true);
