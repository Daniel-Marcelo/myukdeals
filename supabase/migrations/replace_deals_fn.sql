-- Atomic replace of a tab/period's deals + a unique constraint on meta.key.
-- Apply in the Supabase dashboard SQL editor (this project has no Supabase CLI).
-- Related: PLAN-feed-freshness.md, PLAN-supabase-security.md.
--
-- NOTE: the SQL editor runs the whole script as ONE transaction — if any statement
-- fails, everything rolls back. The function is created FIRST (below) so a hiccup on
-- the meta constraint can't prevent it. If you're unsure, run each of the two
-- statements below as its own query.

-- 1) Replace all deals for one tab/period inside a SINGLE transaction. A plpgsql
-- function body is one transaction: if the insert fails, the delete rolls back,
-- so the feed is never left empty by a half-failed scrape.
create or replace function public.replace_deals(p_tab text, p_period text, p_deals jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  if jsonb_array_length(p_deals) = 0 then
    raise exception 'refusing to replace % / % with an empty deal set', p_tab, p_period;
  end if;

  delete from public.deals where tab = p_tab and period = p_period;

  -- Explicit column list + coalesce(scraped_at, now()) is deliberate: the scraper's
  -- JSON has no scraped_at, and `insert ... select *` would write an explicit NULL
  -- that BYPASSES the column default, breaking freshness/age display.
  insert into public.deals
    (id, title, description, price, merchant, temperature, comment_count,
     image_url, deal_url, merchant_url, tab, period, order_index, posted_at,
     trending_for, scraped_at)
  select r.id, r.title, r.description, r.price, r.merchant, r.temperature,
         r.comment_count, r.image_url, r.deal_url, r.merchant_url, r.tab,
         r.period, r.order_index, r.posted_at, r.trending_for,
         coalesce(r.scraped_at, now())
  from jsonb_populate_recordset(null::public.deals, p_deals) r;

  get diagnostics n = row_count;
  return n;
end $$;

-- 2) meta.key must be unique for the scraper's upsert(..., { onConflict: 'key' }).
-- Defensive: only add the constraint if `key` has no single-column PK/unique yet,
-- so re-running this file (or a meta that already has a PK) won't error.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.meta'::regclass
      and c.contype in ('p', 'u')
      and a.attname = 'key'
      and array_length(c.conkey, 1) = 1
  ) then
    alter table public.meta add constraint meta_key_uniq unique (key);
  end if;
end $$;

-- Function is SECURITY INVOKER (default). Under RLS (enable_rls.sql) it is called
-- by the service-role client, which bypasses RLS. Execute is revoked from anon/
-- authenticated there as defence in depth.
