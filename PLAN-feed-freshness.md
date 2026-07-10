# PLAN: Feed freshness — self-healing scrapes, atomic replace, visible "Updated X ago"

**Rank: 1 of 5 (do this first).**

## Goal

The feed currently depends entirely on an external cron hitting `/api/scrape/hot` and `/api/scrape/trending` with an `x-cron-secret` header. There is no fallback and no visibility:

1. If the cron stops (verified: `meta` table still holds a dead `last_scraped_at` row from 2026-06-28 that nothing updates), the feed silently serves days-old deals. The user cannot tell.
2. `scrapeTabNow()` in [lib/scraper.ts](lib/scraper.ts) does **delete-then-insert without a transaction**. If the insert fails after the delete succeeds (schema drift, Supabase hiccup, HUKD markup change producing bad data), the `deals` table is left **empty** for that tab/period until the next successful scrape.

After this plan:
- Scrape replaces deals atomically (a Postgres function, one transaction — failure rolls back, old deals survive).
- `/api/deals` detects staleness (>30 min) and triggers a background re-scrape via Next's `after()`, so the external cron is no longer a single point of failure. (Vercel Hobby cron only supports ~daily runs, which is why the cron is external; keep it — this is a fallback, not a replacement.)
- The UI shows "Updated 12m ago" so staleness is visible.

## Context you must know (verified against the live DB on 2026-07-08)

- `deals` columns: `id, title, description, price, merchant, temperature, image_url, deal_url, merchant_url, tab, posted_at, scraped_at, comment_count, order_index, trending_for, period`.
  - **`scraped_at` is NOT in the scraper's `Deal` type** — it is filled by a DB default (`now()`) on insert. This matters in step 2.
- `meta` columns: `key, value` (text). Contains one stale row `key='last_scraped_at'`. The code no longer reads or writes `meta` anywhere (commit 375bb30 removed it).
- The external cron IS currently alive (deals scraped_at showed 12:01 UTC today) and scrapes hot `today`, hot `week`, and trending.
- `/api/deals` (route: [app/api/deals/route.ts](app/api/deals/route.ts)) reads deals with the **anon** client from `lib/supabase.ts` and user data with the authed client from `lib/supabase-server.ts`. Keep that split.
- Trending rows are stored with `period='today'` (the scraper's default param). The deals API maps trending → `period='today'`. Preserve this.

## Before writing any code

Per [AGENTS.md](AGENTS.md), read these bundled Next 16 docs (paths relative to repo root):
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md` — `after()` runs work after the response is sent; available in Route Handlers; errors inside it must be caught by you.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/` — `maxDuration` export.

Note: Route Handlers in Next 16 are uncached by default; the existing `export const dynamic = 'force-dynamic'` in the deals route is redundant but harmless — leave it.

## Files to touch

| File | Change |
|---|---|
| `supabase/migrations/replace_deals_fn.sql` | NEW — transactional replace function + meta constraint check |
| `lib/scraper.ts` | Use RPC instead of delete+insert; write `meta` timestamp on success; add `scrapeIfStale()` |
| `app/api/deals/route.ts` | Return `last_scraped_at`; trigger background scrape when stale; `maxDuration` |
| `lib/format.ts` | NEW — move `formatAge()` here (currently duplicated in DealCard and SavedFeed) |
| `components/DealCard.tsx`, `components/SavedFeed.tsx` | Import `formatAge` from `lib/format` |
| `components/DealFeed.tsx` | Show "Updated X ago" + subtle refreshing indicator |

## Implementation order

### Step 1 — Verify DB constraints (Supabase dashboard → SQL editor)

This repo has **no Supabase CLI setup**; migrations are applied by pasting SQL into the dashboard SQL editor (still commit the `.sql` file for the record). First run:

```sql
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.deals'::regclass, 'public.meta'::regclass);
```

- If `meta` has **no** primary key / unique constraint on `key`, add one: `alter table public.meta add primary key (key);` (needed for `upsert` with `onConflict: 'key'`).
- Note what the `deals` PK is. You do not need it for this plan (the function deletes by tab/period and inserts fresh rows), but record it in the migration file as a comment — PLAN-dismissed-hardening and future work rely on it.

### Step 2 — Create the transactional replace function

New file `supabase/migrations/replace_deals_fn.sql`. A plpgsql function body is a single transaction: if the insert fails, the delete rolls back too.

```sql
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
```

**Edge case a naive implementation misses:** `insert into deals select * from jsonb_populate_recordset(...)` (without an explicit column list) would insert `scraped_at = NULL` for every row, because the scraper's JSON has no `scraped_at` key and an explicit NULL **bypasses the column default**. That silently breaks freshness display and the deal-age chip. The explicit column list with `coalesce(r.scraped_at, now())` above is deliberate — keep it.

Leave the function as SECURITY INVOKER (the default). PLAN-supabase-security later restricts who may execute it — note the cross-reference in a SQL comment.

### Step 3 — Rewire `scrapeTabNow` in `lib/scraper.ts`

Replace the delete + insert block (currently lines ~136–140) with:

```ts
const { data: inserted, error } = await supabase.rpc('replace_deals', {
  p_tab: tab,
  p_period: period,
  p_deals: deals,
})
if (error) throw new Error(`replace_deals failed for ${tab}/${period}: ${error.message}`)
```

Then, still inside `scrapeTabNow` after success, record freshness:

```ts
await supabase.from('meta').upsert(
  { key: `last_scraped:${tab}:${period}`, value: new Date().toISOString() },
  { onConflict: 'key' }
)
```

Putting the meta write **inside `scrapeTabNow`** means every path (cron routes, debug-scrape, and the new self-heal) updates it — do not put it in the API routes.

Client note: use the same client the scraper currently uses for writes (`supabase` from `lib/supabase.ts`). If `lib/supabase-admin.ts` exists (created by PLAN-supabase-security), use that instead.

### Step 4 — Add `scrapeIfStale` to `lib/scraper.ts`

```ts
const STALE_MS = 30 * 60 * 1000

export async function scrapeIfStale(tab: 'hot' | 'trending', period: HotPeriod): Promise<boolean> {
  const key = `last_scraped:${tab}:${period}`
  const { data } = await supabase.from('meta').select('value').eq('key', key).maybeSingle()
  const last = data?.value ? Date.parse(data.value) : 0
  if (Date.now() - last < STALE_MS) return false

  // Claim the slot BEFORE scraping so concurrent requests don't double-scrape.
  await supabase.from('meta').upsert(
    { key, value: new Date().toISOString() },
    { onConflict: 'key' }
  )
  try {
    await scrapeTabNow(tab, period)
    return true
  } catch (err) {
    console.error(`Self-heal scrape failed for ${tab}/${period}:`, err)
    // Restore the old timestamp so the next request retries instead of waiting 30 min.
    await supabase.from('meta').upsert(
      { key, value: new Date(last).toISOString() },
      { onConflict: 'key' }
    )
    return false
  }
}
```

Also export a small helper `getLastScraped(tab, period): Promise<string | null>` that reads the same meta key, for the API route.

**Edge cases:**
- First run ever: no meta row → `last = 0` → stale → scrapes. Correct.
- `Date.parse` of a corrupted value returns `NaN`; `Date.now() - NaN < STALE_MS` is `false`, so it correctly treats it as stale (NaN comparisons are false). Do not "fix" this with extra checks.
- The claim-first pattern means a failed scrape briefly looks fresh to concurrent requests; the catch block restores it. Acceptable for a single-user app.

### Step 5 — `/api/deals` self-heal + freshness in response

In [app/api/deals/route.ts](app/api/deals/route.ts):

```ts
import { after } from 'next/server'
import { scrapeIfStale, getLastScraped } from '@/lib/scraper'

export const maxDuration = 60
```

After computing `tab` and `period` (remember: effective period for trending is `'today'`):

```ts
const effectivePeriod = tab === 'hot' ? period : 'today'
const lastScraped = await getLastScraped(tab, effectivePeriod)
const isStale = !lastScraped || Date.now() - Date.parse(lastScraped) > 30 * 60 * 1000
if (isStale) {
  after(async () => {
    try { await scrapeIfStale(tab, effectivePeriod) }
    catch (err) { console.error('background scrape failed:', err) }
  })
}
```

Include both in the JSON response: `{ deals, last_scraped_at: lastScraped, refreshing: isStale }`.

**Edge cases:**
- The `try/catch` inside `after()` is mandatory — an unhandled rejection there produces noisy function crashes in Vercel logs with no request to attach to.
- Only trigger the scrape for the tab/period actually requested — never `scrapeNow()` (both tabs), which could exceed the function budget.
- `scrapeIfStale` re-checks staleness internally, so the `after()` callback racing another request is safe.
- HUKD sometimes 403s datacenter IPs. That surfaces as `scrapeTabNow` throwing → timestamp restored → next request retries. No action needed, but don't add retries inside the request path.
- The `week` period relies on HUKD's `navi` cookie ([lib/scraper.ts:29-33](lib/scraper.ts)); if HUKD changes that cookie format, week silently returns today's data. Out of scope, but don't be surprised in testing if week ≈ today near the start of a week.

### Step 6 — UI: show freshness

1. Create `lib/format.ts`, move `formatAge` there (it exists identically in [DealCard.tsx:21-28](components/DealCard.tsx) and [SavedFeed.tsx:10-17](components/SavedFeed.tsx)); update both to import it.
2. In [DealFeed.tsx](components/DealFeed.tsx): capture `last_scraped_at` and `refreshing` from the response into state. In the header row (next to the "N deals" count), render:
   - `Updated {formatAge(lastScrapedAt)}` in the same muted style as the count (`text-xs text-[#8a8f98]/60`) when present.
   - When `refreshing` is true, also render a `RefreshCw` icon (`w-3 h-3 animate-spin`) and schedule **one** re-fetch ~20s later so the fresh data appears without user action: `setTimeout` in a `useEffect`, cleared on unmount/dep change. Guard so it doesn't loop if the scrape keeps failing (only re-fetch once per mount).

### Step 7 — Cleanup

Delete the dead meta row in the SQL editor: `delete from public.meta where key = 'last_scraped_at';` (the new keys are `last_scraped:{tab}:{period}`).

## Acceptance criteria

1. `npm run build` passes with no type errors.
2. Atomicity: in the SQL editor, call `select replace_deals('hot','today','[]'::jsonb)` → it raises the "empty deal set" exception and `select count(*) from deals where tab='hot' and period='today'` is unchanged.
3. Self-heal: in SQL editor, `update meta set value = '2020-01-01T00:00:00Z' where key = 'last_scraped:hot:today';` then load the app (Hot/Today). The response includes `refreshing: true`; within ~30s `select max(scraped_at) from deals where tab='hot' and period='today'` is current and the meta row is updated. The UI re-fetches once and shows fresh deals with "Updated just now".
4. Freshness display: header shows "Updated Xm ago" on hot and trending tabs.
5. No null `scraped_at`: after a scrape, `select count(*) from deals where scraped_at is null` = 0.
6. Cron path unaffected: `curl -H "x-cron-secret: $CRON_SECRET" https://<host>/api/scrape/hot?period=week` still returns a count > 0 and updates `meta.last_scraped:hot:week`.
7. Fresh feed does NOT trigger a scrape: load the app twice within a minute; Vercel/dev logs show only one scrape.

## Out of scope

- Locking down who can execute `replace_deals` → PLAN-supabase-security.
- Client-side error states → PLAN-client-resilience.
