-- Dedupe existing rows, then add unique (user_id, deal_id) to dismissed and saved
-- so the app's upserts can no-op / refresh instead of duplicating or 500-ing.
-- Apply in the Supabase dashboard SQL editor. Related: PLAN-dismissed-hardening.md.
--
-- The dedupe DELETEs must run BEFORE the ADD CONSTRAINTs (you cannot create a
-- unique constraint while duplicates exist). ctid is Postgres's physical row id.

-- dismissed: keep one row per (user_id, deal_id).
delete from public.dismissed a
using public.dismissed b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and a.ctid > b.ctid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dismissed'::regclass and conname = 'dismissed_user_deal_uniq'
  ) then
    alter table public.dismissed add constraint dismissed_user_deal_uniq unique (user_id, deal_id);
  end if;
end $$;

-- saved: keep the MOST RECENT row per (user_id, deal_id), then tie-break by ctid.
delete from public.saved a
using public.saved b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and coalesce(a.saved_at, 'epoch'::timestamptz) < coalesce(b.saved_at, 'epoch'::timestamptz);

delete from public.saved a
using public.saved b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and a.saved_at is not distinct from b.saved_at
  and a.ctid > b.ctid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.saved'::regclass and conname = 'saved_user_deal_uniq'
  ) then
    alter table public.saved add constraint saved_user_deal_uniq unique (user_id, deal_id);
  end if;
end $$;
