# PLAN: The freshness timestamp lies — split the scrape lock from the last-success time

**Rank: 1 of 5. Do this first.**

## Goal

The app's entire value is "show me deals that are fresh". Right now the UI can confidently
display **"Updated just now" over deals that are 45 minutes old**, and then refuse to refresh
them for another 30 minutes. This is the sharpest correctness bug in the codebase.

> **Context: an external cron does call `/api/scrape/hot` and `/api/scrape/trending`.** That is the
> primary refresh path; `scrapeIfStale` is the fallback for when the cron is late, has failed, or
> doesn't cover a given feed. The bug below is entirely in the fallback path — but that path is
> exactly what runs when the cron is *not* working, i.e. the moment you most need the freshness
> indicator to be honest. It is also the **only** path for `hot`/`week` unless the cron passes
> `?period=week` (the route defaults to `today`) — check your scheduler; if it only calls the
> default, the Week toggle has been served entirely by the buggy path.

### Root cause

[lib/scraper.ts](lib/scraper.ts) uses **one** meta key for two different jobs:

```ts
// lib/scraper.ts:106-126 — scrapeIfStale
const key = `last_scraped:${tab}:${period}`
const { data } = await supabaseAdmin.from('meta').select('value').eq('key', key).maybeSingle()
const last = data?.value ? Date.parse(data.value) : 0
if (Date.now() - last < STALE_MS) return false

// Claim the slot BEFORE scraping so a concurrent request sees "fresh" and skips.
await supabaseAdmin.from('meta').upsert({ key, value: new Date().toISOString() }, ...)
```

`last_scraped:{tab}:{period}` is simultaneously:
1. **the concurrency lock** (claimed *before* scraping, to stop a thundering herd), and
2. **the value shown to the user** — [app/api/deals/route.ts:23-28](app/api/deals/route.ts) reads it
   via `getLastScraped()` and returns it as `last_scraped_at`, which
   [components/DealFeed.tsx:172](components/DealFeed.tsx) renders as `Updated {formatAge(...)}`.

Claiming the lock therefore **overwrites the user-facing freshness value with a time at which
nothing has actually been scraped yet.**

### The failure, step by step (this is what to fix — verify you understand it before editing)

| t | What happens |
|---|---|
| 0s | User opens the app after 45 min. `GET /api/deals`. `getLastScraped()` → 45 min ago → `isStale: true`. Response: **old deals**, `last_scraped_at` = 45 min ago, `refreshing: true`. `after()` schedules `scrapeIfStale`. |
| ~0s | `scrapeIfStale` sees 45 min > 30 min, **upserts `last_scraped` = NOW**, then starts fetching 3 HUKD pages (~300 KB each, sequential — takes 5–30 s). |
| 0s | Client renders "Updated 45m ago" + spinner, schedules **one** refetch at t=20 s, and adds `hot:today` to `refetchedKeys` ([DealFeed.tsx:87-94](components/DealFeed.tsx)). |
| 20s | Refetch. `getLastScraped()` → **NOW** (the lock claim). `isStale: false` → `refreshing: false`, **no new scrape scheduled**. The deals query still returns the OLD rows because `replace_deals` hasn't committed. |
| 20s | Client renders **"Updated just now"** over 45-minute-old deals, spinner off. |
| 20s+ | `refetchedKeys` already contains `hot:today`, so the auto-refetch **never fires again** for this mount. And `/api/deals` won't schedule another scrape for 30 min. |

Two ways this gets worse:

- **If the scrape fails**, the `catch` at [scraper.ts:118-124](lib/scraper.ts) restores the old
  timestamp — that path is handled correctly. **But if the function is killed** (Vercel suspends
  `after()` work, or `maxDuration = 60` fires, or the HUKD fetch hangs — there is **no timeout on
  the `fetch` at [scraper.ts:26](lib/scraper.ts)**), the `catch` never runs. The claimed-fresh
  timestamp sticks and the feed is frozen for 30 minutes while insisting it is current.
- **If the scrape takes longer than 20 s**, the single refetch lands too early and the one-shot
  guard means the client never tries again.

### After this plan

- `last_scraped:{tab}:{period}` is written **only after a scrape has actually committed**, so
  "Updated X ago" is always true.
- A separate, TTL'd `scrape_lock:{tab}:{period}` key does the concurrency job.
- A hung HotUKDeals connection can no longer eat the whole function budget (per-request timeout
  + one retry).
- The client polls with bounded backoff until the timestamp actually advances, instead of firing
  one shot in the dark.

## Exact files to touch

| File | Change |
|------|--------|
| [lib/scraper.ts](lib/scraper.ts) | Split lock from last-success; add fetch timeout + retry |
| [app/api/deals/route.ts](app/api/deals/route.ts) | No logic change; confirm `isStale` still derives from `getLastScraped()` |
| [components/DealFeed.tsx](components/DealFeed.tsx) | Replace the one-shot 20 s refetch with bounded backoff polling keyed on the timestamp advancing |
| `lib/scraper.test.ts` | **New.** Unit-test the pure lock/staleness decision |

No database migration is needed — `meta` is already a key/value table with a unique constraint on
`key` ([supabase/migrations/replace_deals_fn.sql:51-64](supabase/migrations/replace_deals_fn.sql)).
You are only adding new rows with a new key prefix.

## Implementation order

### Step 1 — `lib/scraper.ts`: add the timeout + retry to `scrapePage`

The `fetch` at line 26 has no `signal`. Add one, and retry once on failure. Put these constants
next to `STALE_MS` (line 19):

```ts
const STALE_MS = 30 * 60 * 1000
const LOCK_TTL_MS = 3 * 60 * 1000      // a claimed lock older than this is treated as abandoned
const FETCH_TIMEOUT_MS = 12_000        // per HUKD page request
```

In `scrapePage`, wrap the existing `fetch` call so it becomes:

```ts
async function fetchPage(url: string, cookie: string): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Referer': 'https://www.hotukdeals.com/',
    ...(cookie ? { Cookie: cookie } : {}),
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        next: { revalidate: 0 },
        // Without this a hung connection blocks until Vercel kills the whole
        // function, which strands the scrape lock (see LOCK_TTL_MS).
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 750))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed to fetch ${url}`)
}
```

`scrapePage` then becomes `const html = await fetchPage(url, cookie); return parseThreadsFromHtml(...)`.

> **Do not** retry inside `scrapeTab`'s page loop as well — one retry per page is enough. Three
> pages × two attempts × 12 s worst case is 72 s, which exceeds `maxDuration = 60`. That is
> acceptable because the lock TTL will release it (Step 2), but do not add a third attempt.

### Step 2 — `lib/scraper.ts`: split the lock out of `scrapeIfStale`

Replace the whole `scrapeIfStale` function (lines 101-126) with:

```ts
/** Reads a meta key as epoch ms. Missing or corrupted values become 0 (= "very old"). */
async function readMetaTime(key: string): Promise<number> {
  const { data } = await supabaseAdmin.from('meta').select('value').eq('key', key).maybeSingle()
  const parsed = data?.value ? Date.parse(data.value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

async function writeMetaTime(key: string, ms: number): Promise<void> {
  await supabaseAdmin
    .from('meta')
    .upsert({ key, value: new Date(ms).toISOString() }, { onConflict: 'key' })
}

/**
 * Self-heal: if the tab/period hasn't been scraped in STALE_MS, scrape it now.
 * Returns true if a scrape ran AND committed.
 *
 * Concurrency is handled by a SEPARATE `scrape_lock:*` key, never by the
 * user-facing `last_scraped:*` key. Claiming the lock must not make the feed
 * claim to be fresh — `last_scraped` is written only by recordScrape(), after
 * replace_deals() has committed.
 */
export async function scrapeIfStale(tab: 'hot' | 'trending', period: HotPeriod): Promise<boolean> {
  const freshKey = `last_scraped:${tab}:${period}`
  const lockKey = `scrape_lock:${tab}:${period}`

  const lastSuccess = await readMetaTime(freshKey)
  if (Date.now() - lastSuccess < STALE_MS) return false

  // Someone else is already scraping this tab/period. A lock older than
  // LOCK_TTL_MS is assumed abandoned (function killed mid-scrape) and reclaimed.
  const lockedAt = await readMetaTime(lockKey)
  if (Date.now() - lockedAt < LOCK_TTL_MS) return false

  await writeMetaTime(lockKey, Date.now())
  try {
    await scrapeTabNow(tab, period) // writes last_scraped on success
    return true
  } catch (err) {
    console.error(`Self-heal scrape failed for ${tab}/${period}:`, err)
    return false
  } finally {
    // Release the lock either way so the next request can retry immediately
    // instead of waiting out the TTL.
    await writeMetaTime(lockKey, 0)
  }
}
```

Note what is **deleted**: the old code's "restore a stale timestamp" logic in the `catch`. That
existed only to undo the premature `last_scraped` write. There is nothing to undo now, because
`last_scraped` is never written speculatively.

`recordScrape` ([scraper.ts:84-89](lib/scraper.ts)) and `getLastScraped` (lines 92-99) are unchanged
— `recordScrape` is already called only after `replace_deals` succeeds, which is exactly the
semantics we now depend on.

### Step 3 — `components/DealFeed.tsx`: bounded backoff instead of one shot

Replace the `refetchedKeys` ref (line 35) and the effect at lines 84-94.

Delete:
```ts
const refetchedKeys = useRef<Set<string>>(new Set())
```

Add, next to the other state:
```ts
// Bounded backoff for the "a background scrape is running" case. We poll until
// last_scraped_at actually ADVANCES past the value we started with — the server
// only writes it after a scrape commits, so it is a truthful completion signal.
const pollAttempt = useRef(0)
const pollBaseline = useRef<string | null>(null)
const POLL_DELAYS_MS = [5000, 8000, 12000, 20000, 30000]
```

Replace the effect with:

```ts
useEffect(() => {
  if (!refreshing) {
    pollAttempt.current = 0
    pollBaseline.current = null
    return
  }
  // First tick of a new refresh cycle: remember what "stale" looked like.
  if (pollBaseline.current === null) pollBaseline.current = lastScrapedAt ?? ''

  // The scrape landed — last_scraped_at moved. Stop.
  if (lastScrapedAt && lastScrapedAt !== pollBaseline.current) {
    pollAttempt.current = 0
    pollBaseline.current = null
    return
  }

  const delay = POLL_DELAYS_MS[pollAttempt.current]
  if (delay === undefined) return // budget exhausted — give up, pull-to-refresh still works

  pollAttempt.current += 1
  const t = setTimeout(() => {
    // Don't burn requests while the PWA is backgrounded on the phone.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    refresh()
  }, delay)
  return () => clearTimeout(t)
}, [refreshing, lastScrapedAt, tab, period, refresh])
```

Reset the counters when the user switches tab or period, so a new feed gets a full budget. Add to
`handlePeriodChange` (line 75) and inside `fetchDeals` before the request:

```ts
pollAttempt.current = 0
pollBaseline.current = null
```

### Step 4 — `lib/scraper.test.ts` (new)

The lock decision is the part worth locking down. Extract it as a pure function in
`lib/scraper.ts` so it can be tested without a database:

```ts
/** Pure decision: given the last successful scrape and the current lock, should we scrape now? */
export function shouldScrape(
  lastSuccessMs: number,
  lockedAtMs: number,
  nowMs: number,
  staleMs = STALE_MS,
  lockTtlMs = LOCK_TTL_MS,
): boolean {
  if (nowMs - lastSuccessMs < staleMs) return false
  if (nowMs - lockedAtMs < lockTtlMs) return false
  return true
}
```

and have `scrapeIfStale` call it. Then:

```ts
import { describe, it, expect } from 'vitest'
import { shouldScrape } from './scraper'

const MIN = 60_000
const now = 1_000_000_000_000

describe('shouldScrape', () => {
  it('skips when the last successful scrape is recent', () => {
    expect(shouldScrape(now - 5 * MIN, 0, now)).toBe(false)
  })
  it('scrapes when stale and unlocked', () => {
    expect(shouldScrape(now - 45 * MIN, 0, now)).toBe(true)
  })
  it('skips when stale but another request holds a live lock', () => {
    expect(shouldScrape(now - 45 * MIN, now - 30_000, now)).toBe(false)
  })
  it('reclaims a lock older than the TTL (function killed mid-scrape)', () => {
    expect(shouldScrape(now - 45 * MIN, now - 10 * MIN, now)).toBe(true)
  })
  it('treats a never-scraped feed (0) as stale', () => {
    expect(shouldScrape(0, 0, now)).toBe(true)
  })
})
```

> `lib/scraper.ts` imports `supabase-admin`, which imports `server-only`. If vitest chokes on that,
> move `shouldScrape` and the two constants into a new `lib/scrape-policy.ts` with **no** imports
> and re-export from `scraper.ts`. Check this before writing the test — it is the most likely thing
> to go wrong in this plan.

## Edge cases found while exploring

1. **`Date.parse` on a corrupted `meta.value` returns `NaN`.** The old code relied on
   `Date.now() - NaN < STALE_MS` being `false` (correct — treated as stale), but then did
   `new Date(last).toISOString()` in the catch, which **throws on NaN** — the old code guarded this
   at line 122. `readMetaTime` above normalises `NaN` to `0` once, at the boundary, so nothing
   downstream has to think about it. Keep that normalisation.
2. **The lock check must fail *open*, not closed.** If `readMetaTime(lockKey)` returns 0 for a
   missing/corrupt row, `Date.now() - 0 < LOCK_TTL_MS` is `false` → not locked → we scrape. That is
   the safe direction. Never invert this comparison.
3. **`scrapeTabNow` does not take the lock**, and the cron routes
   ([app/api/scrape/hot/route.ts](app/api/scrape/hot/route.ts),
   [trending](app/api/scrape/trending/route.ts)) call it directly. A cron scrape overlapping a
   self-heal scrape means two `replace_deals` calls. That is *safe* — the function is a single
   transaction ([replace_deals_fn.sql:13-46](supabase/migrations/replace_deals_fn.sql)) — just
   wasted work. Do **not** try to make the cron routes take the lock; a manually-triggered scrape
   should always run.
4. **`replace_deals` refuses an empty deal set** (raises an exception). So a scrape that parses
   zero deals throws, `last_scraped` is never written, the lock is released in `finally`, and the
   next request retries. Correct — don't "fix" it.
5. **`after()` runs even when the response errored**, per the Next 16 docs
   (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`). The existing
   try/catch at [route.ts:33-39](app/api/deals/route.ts) is required and must stay.
6. **`refreshing` is `true` for `hot`+`week` independently of `hot`+`today`.** Switching the period
   toggle starts a *separate* scrape with its own lock. The poll counters must reset on period
   change or the second feed inherits an exhausted budget (Step 3 handles this).
7. **Don't poll on a hidden tab.** iOS aggressively backgrounds standalone PWAs; a `setTimeout`
   that fires on resume would fire a burst. The `visibilityState` guard covers it.
8. **`POLL_DELAYS_MS` totals 75 s.** That is deliberately longer than a worst-case scrape
   (3 pages × 12 s timeout + 1 retry) so the poll outlives the work it is waiting for.

## Acceptance criteria

Run these in order. Every one must pass.

1. `npm test` — the new `shouldScrape` tests pass, the 6 existing parser tests still pass.
2. `npm run build` — clean.
3. **The lie is gone.** In the Supabase SQL editor:
   ```sql
   select key, value from public.meta where key like 'last_scraped:%' or key like 'scrape_lock:%';
   ```
   Force staleness for one feed:
   ```sql
   update public.meta set value = (now() - interval '2 hours')::text
   where key = 'last_scraped:hot:today';
   ```
   Then load the app. While the scrape is in flight, re-run the select: `scrape_lock:hot:today`
   holds a recent timestamp and **`last_scraped:hot:today` is still 2 hours old**. After the scrape
   commits, `last_scraped:hot:today` jumps to now and `scrape_lock:hot:today` is back to
   `1970-01-01T00:00:00.000Z`.
4. **The UI never claims to be fresher than it is.** During the same window the header shows
   "Updated 2h ago" with a spinner — *not* "Updated just now" — and flips to "Updated just now"
   only once the new deals are actually on screen.
5. **It converges.** With the app open and a forced-stale feed, the deals refresh on their own
   within ~30 s without a manual pull-to-refresh, and the spinner stops.
6. **An abandoned lock self-heals.** Simulate a killed function:
   ```sql
   update public.meta set value = (now() - interval '2 hours')::text where key = 'last_scraped:hot:today';
   insert into public.meta (key, value) values ('scrape_lock:hot:today', (now() - interval '10 minutes')::text)
   on conflict (key) do update set value = excluded.value;
   ```
   Load the app — a scrape still runs (10 min > 3 min TTL). Repeat with `interval '1 minute'` — no
   scrape runs (lock is live).
7. **No poll loop.** With HUKD unreachable (temporarily point `TAB_URLS.hot` at
   `https://www.hotukdeals.com/definitely-not-a-page` locally), the client makes **at most 5**
   `/api/deals` requests after the initial one and then stops. Check the Network panel. Revert the
   URL afterwards.
