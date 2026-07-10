# PLAN: Dismissed & saved write-hardening — dedupe writes, bound the feed query so it can't blow up as dismissals grow

**Rank: 3 of 5.**

## Goal

Two latent defects that both get *worse the more the app is used* — which for a swipe-to-dismiss app is every day:

1. **The dismissed filter is an unbounded `IN (...)` list baked into the request URL.** [app/api/deals/route.ts](app/api/deals/route.ts) builds `query.not('id', 'in', `(${dismissedIds.join(',')})`)` from **every** dismissed id the user has ever accumulated. `dismissed` has no cap and is only cleared by a manual "Reset dismissed". After a few thousand dismissals the generated PostgREST URL exceeds server/proxy URL-length limits and the feed starts returning 500s **permanently** until the user resets. The whole point of the app (dismiss deals continuously) is what breaks it.
2. **`dismiss` inserts without deduping.** [app/api/dismiss/route.ts](app/api/dismiss/route.ts) does `client.from('dismissed').insert({ deal_id, user_id })`. A deal can legitimately be dismissed twice (it reappears in a later scrape and the user swipes it again, or a double-tap). Depending on whether a unique constraint exists, that either throws a 500 (unique violation) or silently piles up duplicate rows that bloat the table and slow every future filter.

`saved` has the mirror problem: [app/api/save/route.ts](app/api/save/route.ts) calls `.upsert({ deal_id, user_id, ... })` **with no `onConflict`**, so it conflicts on the primary key only. If the `saved` PK is a synthetic `id`, the upsert never dedupes and re-saving a deal creates duplicate rows (which then render twice in the Saved feed).

After this plan:
- The feed query is **bounded**: it only ever excludes dismissed ids that are actually in the current candidate set (≤150 deals), so the URL length is constant regardless of dismissed-table size.
- `dismissed` and `saved` each have a real `unique (user_id, deal_id)` constraint, and their write routes upsert with `onConflict` so repeats are no-ops.

## Context you must know (verified against the code on 2026-07-09)

- **Current `/api/deals` flow** ([app/api/deals/route.ts](app/api/deals/route.ts)): fetches `dismissed` (all rows) and `prefs` in parallel, fetches deals (`limit(150)`) with the anon `supabase` client, then excludes dismissed via the big `IN` list and filters blocked merchants in JS. Deals are read with the **anon** client; `dismissed`/`prefs` with the **authed** client (`createClient` from `lib/supabase-server.ts`).
- Deal ids are numeric strings parsed from `article id="thread_<id>"` (see [lib/scraper.ts:61](lib/scraper.ts)). They never contain commas or parentheses, so the current interpolation is not an *injection* risk — the problem is purely **length** and duplicate rows.
- `dismissed` and `saved` both have `user_id` and `deal_id` columns. `saved` also has `deal_data` (jsonb snapshot) and `saved_at`.
- Git history shows `saved`'s schema was hand-edited repeatedly (`3e65c9a Use upsert on save…`, `9e6fb71`, `266eb23`), so **do not assume** its constraints — verify in Step 1.
- **Ordering vs other plans:** [PLAN-feed-freshness](PLAN-feed-freshness.md) also edits `app/api/deals/route.ts` (adds staleness detection + `after()` + returns `last_scraped_at`/`refreshing`). Do feed-freshness first. This plan then **replaces only the dismissed-filtering block**; keep every freshness addition intact. If RLS is being added ([PLAN-supabase-security](PLAN-supabase-security.md)), the new unique constraints and upserts are unaffected by it (writes still go through the authed user client, which satisfies the `own dismissed`/`own saved` policies).

## Files to touch

| File | Change |
|---|---|
| `supabase/migrations/dedupe_constraints.sql` | NEW — dedupe existing rows, add `unique (user_id, deal_id)` to `dismissed` and `saved` |
| `app/api/dismiss/route.ts` | `insert` → `upsert(..., { onConflict: 'user_id,deal_id', ignoreDuplicates: true })` |
| `app/api/save/route.ts` | add `{ onConflict: 'user_id,deal_id' }` to the existing upsert |
| `app/api/deals/route.ts` | replace the unbounded `IN`-list filter with a bounded lookup |

## Implementation order

### Step 1 — Inspect current constraints (SQL editor)

```sql
select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.dismissed'::regclass, 'public.saved'::regclass)
order by tbl;

-- how many duplicate (user_id, deal_id) pairs already exist?
select 'dismissed' t, count(*) - count(distinct (user_id, deal_id)) dupes from public.dismissed
union all
select 'saved', count(*) - count(distinct (user_id, deal_id)) from public.saved;
```

Record the output as a comment in the migration. If a `unique (user_id, deal_id)` already exists on a table, skip adding it there (but still switch the route to `onConflict` on that pair).

### Step 2 — Dedupe existing rows, then add the constraints (new migration)

New file `supabase/migrations/dedupe_constraints.sql`. **You cannot add a unique constraint while duplicates exist** — delete the extra rows first, keeping one per pair. `ctid` is Postgres's built-in physical row id; this keeps the lowest-`ctid` row of each group:

```sql
-- dismissed: keep one row per (user_id, deal_id)
delete from public.dismissed a
using public.dismissed b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and a.ctid > b.ctid;

alter table public.dismissed
  add constraint dismissed_user_deal_uniq unique (user_id, deal_id);

-- saved: keep the MOST RECENT row per (user_id, deal_id) (preserve newest saved_at/deal_data)
delete from public.saved a
using public.saved b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and coalesce(a.saved_at, 'epoch'::timestamptz) < coalesce(b.saved_at, 'epoch'::timestamptz);
-- tie-break any exact-timestamp dupes by ctid
delete from public.saved a
using public.saved b
where a.user_id = b.user_id
  and a.deal_id = b.deal_id
  and a.saved_at is not distinct from b.saved_at
  and a.ctid > b.ctid;

alter table public.saved
  add constraint saved_user_deal_uniq unique (user_id, deal_id);
```

### Step 3 — Dedupe the write routes

[app/api/dismiss/route.ts](app/api/dismiss/route.ts) — change the insert (line 12) to an upsert that no-ops on repeat:

```ts
const { error } = await client
  .from('dismissed')
  .upsert({ deal_id, user_id: user.id }, { onConflict: 'user_id,deal_id', ignoreDuplicates: true })
```

`ignoreDuplicates: true` issues `ON CONFLICT DO NOTHING`, so re-dismissing returns success with no error and no duplicate row.

[app/api/save/route.ts](app/api/save/route.ts) — add the conflict target to the existing upsert (line 12):

```ts
const { error } = await client
  .from('saved')
  .upsert(
    { deal_id, user_id: user.id, deal_data: deal, saved_at: new Date().toISOString() },
    { onConflict: 'user_id,deal_id' }
  )
```

Here we **do** want the default `DO UPDATE` (no `ignoreDuplicates`), so re-saving refreshes `deal_data`/`saved_at` in place instead of erroring or duplicating.

### Step 4 — Bound the feed query (the important one)

In [app/api/deals/route.ts](app/api/deals/route.ts), the current shape is: fetch dismissed (all) + prefs in parallel → fetch deals → exclude via `IN` list. Restructure so dismissed is only ever queried for the **candidate deal ids**:

1. Fetch `prefs` (and, if feed-freshness added it, the freshness read) — these don't depend on deal ids.
2. Fetch the candidate deals first (the existing `supabase.from('deals')…limit(150)` query) **without** the `.not('id','in',…)` clause. Remove that clause and the `dismissedIds`/`dismissed` fetch that feeds it.
3. Derive the candidate ids and query only the dismissed rows among them:

```ts
const candidates = rawDeals ?? []
const ids = candidates.map((d) => d.id)

let dismissedIds: string[] = []
if (ids.length > 0) {
  const { data: dismissedRows } = await client
    .from('dismissed')
    .select('deal_id')
    .in('deal_id', ids)          // bounded: at most ~150 ids, constant-size query
  dismissedIds = dismissedRows?.map((r) => r.deal_id) ?? []
}
const dismissedSet = new Set(dismissedIds)

const deals = candidates.filter((d) => {
  if (dismissedSet.has(d.id)) return false
  if (blockedMerchants.length > 0 && d.merchant &&
      blockedMerchants.includes(d.merchant.toLowerCase().trim())) return false
  return true
})
```

This makes both the deals query and the dismissed query bounded by the 150-row page, independent of how large `dismissed` grows. Keep everything feed-freshness added (the `after()` scrape trigger and the `{ deals, last_scraped_at, refreshing }` response shape) — only the dismissed-filtering mechanism changes.

**Latency note:** this trades one parallel fetch for one sequential fetch (dismissed now waits for deal ids). That is one extra ~20ms round-trip on a request that already does a scrape check — acceptable, and correct. You may still run the `prefs` fetch in parallel with the deals fetch; only the `dismissed` fetch must wait for ids.

## Edge cases a weaker model will miss

- **Adding the unique constraint fails if duplicates remain.** Step 2's dedupe deletes **must** run before the `alter table … add constraint`, in the same migration, in that order. If `add constraint` errors with "could not create unique index … duplicate key", the dedupe did not cover a case — re-run the count query from Step 1.
- **`saved` dedupe must keep the newest row, not an arbitrary one** — otherwise re-saving an updated deal could leave the stale snapshot. That's why Step 2 orders by `saved_at` before the `ctid` tie-break. `saved_at` can be null on legacy rows; `coalesce(..., 'epoch')` handles that.
- **`onConflict` string must name the columns, not the constraint** — Supabase expects `'user_id,deal_id'` (comma-separated column list, no spaces), matching the unique constraint's columns. `'dismissed_user_deal_uniq'` will not work.
- **`.in('deal_id', ids)` with an empty `ids`** would generate `deal_id=in.()` and can error or match nothing — guard with `if (ids.length > 0)` as shown. When there are no candidate deals there's nothing to filter anyway.
- **Type of `deal_id` vs `deals.id`.** Both derive from the same HUKD numeric string. If `dismissed.deal_id` is stored as `text` and `deals.id` as `bigint` (or vice-versa), `.in()` still works because PostgREST coerces, but the JS `Set` compare in the filter is **string-vs-string** only if both come back as the same JS type. `select('deal_id')` and `deals.map(d => d.id)` both return whatever the column type serializes to (numbers stay numbers, text stays strings). To be safe against a type mismatch, normalise both sides: `new Set(dismissedIds.map(String))` and compare `dismissedSet.has(String(d.id))`. Add the `String()` coercion — it is cheap insurance and a real trap if the two columns' types ever differ.
- **Do not reintroduce the `IN` list "just for safety".** The whole point is to stop sending it. If you keep both, the URL-length bug is still present.
- **RLS interaction** ([PLAN-supabase-security](PLAN-supabase-security.md)): the bounded `dismissed` fetch uses the **authed** client, so the `own dismissed` policy (`auth.uid() = user_id`) already scopes it to the current user — you do **not** need to add `.eq('user_id', user.id)`, though adding it is harmless and makes intent explicit.

## Acceptance criteria

1. `pg_constraint` shows `dismissed_user_deal_uniq` and `saved_user_deal_uniq` (or pre-existing equivalents) as `unique (user_id, deal_id)`.
2. **Re-dismiss is a no-op:** dismiss the same deal twice → both POSTs return 200, and `select count(*) from dismissed where deal_id = '<id>' and user_id = '<uid>'` = 1.
3. **Re-save updates in place:** save a deal, then save it again → `select count(*) from saved where deal_id='<id>'` = 1 and its `saved_at` reflects the second save.
4. **Feed query is bounded:** with, say, 3,000 rows in `dismissed`, load the feed and inspect the outbound PostgREST request (dev tools / server logs). The `deals` request carries **no** giant `id=not.in.(…)` param, and the `dismissed` request's `deal_id=in.(…)` contains at most ~150 ids. The feed loads without a 500.
5. **Filtering still correct:** a dismissed deal does not appear; a blocked-merchant deal does not appear; everything else does.
6. `npm run build` passes.

## Out of scope

- Enabling RLS / policies on these tables → [PLAN-supabase-security](PLAN-supabase-security.md).
- Rolling back a *failed* dismiss in the UI (optimistic remove that didn't persist) → [PLAN-client-resilience](PLAN-client-resilience.md).
- Auto-pruning very old dismissed rows (a cron `delete from dismissed where dismissed_at < now() - interval '90 days'`) — nice-to-have, not needed once the query is bounded. Note it and move on.
