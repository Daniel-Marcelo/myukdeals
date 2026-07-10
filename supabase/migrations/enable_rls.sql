-- Enable Row Level Security on every table and add least-privilege policies.
-- Apply in the Supabase dashboard SQL editor. Related: PLAN-supabase-security.md.
--
-- DIAGNOSE FIRST (paste separately, record the output): if deals.rls_enabled is
-- false, the public anon key can currently wipe/read everything — do this urgently.
--   select relname, relrowsecurity from pg_class
--   where relname in ('deals','dismissed','saved','meta','user_preferences')
--     and relnamespace = 'public'::regnamespace;
--
-- Enable RLS and create policies TOGETHER — enabling RLS with no policy denies all.

-- deals: public read (scraped public data). The /api/deals route reads with a
-- cookie-less anon client, so the SELECT policy MUST include the `anon` role.
-- No write policy -> only the service-role key (bypasses RLS) can write.
alter table public.deals enable row level security;
drop policy if exists "deals are readable by anyone" on public.deals;
create policy "deals are readable by anyone"
  on public.deals for select to anon, authenticated using (true);

-- meta: freshness timestamps, read by /api/deals via the anon-keyed scraper module.
alter table public.meta enable row level security;
drop policy if exists "meta is readable by anyone" on public.meta;
create policy "meta is readable by anyone"
  on public.meta for select to anon, authenticated using (true);

-- dismissed: each user manages only their own rows.
alter table public.dismissed enable row level security;
drop policy if exists "own dismissed" on public.dismissed;
create policy "own dismissed" on public.dismissed
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- saved: same.
alter table public.saved enable row level security;
drop policy if exists "own saved" on public.saved;
create policy "own saved" on public.saved
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_preferences already has RLS + policy (add_user_preferences.sql). Verify:
--   select relrowsecurity from pg_class where relname = 'user_preferences';

-- Defence in depth: only the service role may execute the replace function.
-- Guarded so this file doesn't error if replace_deals_fn.sql hasn't run yet.
do $$
begin
  if exists (
    select 1 from pg_proc
    where proname = 'replace_deals' and pronamespace = 'public'::regnamespace
  ) then
    revoke execute on function public.replace_deals(text, text, jsonb) from anon, authenticated;
  end if;
end $$;
