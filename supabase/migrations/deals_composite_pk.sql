-- Make the deals primary key composite: (id, tab, period).
-- Apply in the Supabase dashboard SQL editor (this project has no Supabase CLI).
-- Related: replace_deals_fn.sql, PLAN-feed-freshness.md.
--
-- WHY: the same HotUKDeals deal legitimately appears in more than one feed — a
-- deal that is hot *today* is usually also hot *this week*. replace_deals only
-- deletes the tab/period it is replacing, so when the hot/week job inserts a deal
-- that the hot/today job already stored, a single-column PK on `id` throws
--   duplicate key value violates unique constraint "deals_pkey".
-- A deal is only unique WITHIN a feed, so the PK must be (id, tab, period).
--
-- Reads are unaffected: every query already filters by tab + period.
-- Run this whole script as one transaction (default in the SQL editor).

-- Drop the existing primary key (single-column `id`, named deals_pkey by default).
-- Guarded so re-running the file is a no-op.
do $$
declare pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.deals'::regclass and contype = 'p';

  if pk_name is not null then
    execute format('alter table public.deals drop constraint %I', pk_name);
  end if;
end $$;

-- Add the composite primary key. If any duplicate (id, tab, period) rows already
-- exist (e.g. a within-feed dupe from an older scrape) this would fail, so clear
-- them first, keeping one row per tuple.
delete from public.deals a
using public.deals b
where a.ctid < b.ctid
  and a.id = b.id and a.tab = b.tab and a.period = b.period;

alter table public.deals add constraint deals_pkey primary key (id, tab, period);
