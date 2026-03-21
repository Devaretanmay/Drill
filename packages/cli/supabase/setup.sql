-- Drill CLI — Supabase Schema
-- Run this in: Supabase SQL Editor → New Query

create table if not exists public.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  key_hash     text unique not null,
  machine_id   text,
  runs_week    integer not null default 0,
  week_reset   timestamptz not null default
               (date_trunc('week', now()) + interval '1 week'),
  plan         text not null default 'free',
  created_at   timestamptz not null default now()
);

create index if not exists idx_users_key_hash
  on public.users (key_hash);

create index if not exists idx_users_email
  on public.users (email);

create or replace function increment_run_count(p_key_hash text)
returns json language plpgsql security definer as $$
declare
  rec public.users%rowtype;
begin
  update public.users
  set    runs_week = 0,
         week_reset = date_trunc('week', now()) + interval '1 week'
  where  key_hash = p_key_hash
    and  week_reset < now();

  update public.users
  set    runs_week = runs_week + 1
  where  key_hash = p_key_hash
  returning * into rec;

  if not found then
    return json_build_object('found', false);
  end if;

  return json_build_object(
    'found',      true,
    'runs_week',  rec.runs_week,
    'plan',       rec.plan,
    'limit',      case when rec.plan = 'free' then 100 else 999999 end,
    'over_limit', rec.runs_week > case when rec.plan = 'free' then 100 else 999999 end
  );
end;
$$;
