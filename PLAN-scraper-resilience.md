# PLAN: Scraper resilience — a fixture test + sanity validation so a HotUKDeals markup change can't silently break the feed

**Rank: 5 of 5.**

## Goal

The scraper is the single most fragile part of the app and the app has **zero tests**. [lib/scraper.ts](lib/scraper.ts) depends entirely on HotUKDeals' HTML: it reads a JSON blob out of a `data-vue3` attribute, builds image URLs from a hand-guessed path template, and scrapes `trending_for` out of the brittle CSS selector `.chip--type-default .size--all-s`. When HUKD changes any of that — which they will, without warning — one of two things happens today, both silent:

1. **Total break:** `thread.title` becomes null for every article → every deal is skipped → `scrapeTabNow` throws "No deals scraped". With [PLAN-feed-freshness](PLAN-feed-freshness.md) the old deals survive and staleness becomes visible, but nobody knows *why* it stopped, and it won't be caught until after deploy.
2. **Partial corruption:** the article structure survives but `merchant`, `price`, `image_url`, or `trending_for` moves → deals still insert, but half of them render with missing prices/images/merchants. Nothing throws. Nothing warns.

After this plan:
- The parser is **decoupled from the network and from Supabase** into a pure function that can be unit-tested.
- A committed HTML fixture + a test lock the parser's contract, so a markup regression **fails CI before it ships**.
- `scrapeTabNow` performs a **sanity check** (enough deals, enough field coverage) and logs a structured warning when a scrape looks degraded, turning silent partial-corruption into an observable signal.

## Context you must know (verified against the code on 2026-07-09)

- **The parse-vs-supabase coupling is the crux.** [lib/scraper.ts:2](lib/scraper.ts) does `import { supabase } from './supabase'`, and [lib/supabase.ts](lib/supabase.ts) calls `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)` at **module load**. `@supabase/supabase-js` throws `supabaseUrl is required` when the URL is undefined. So **importing `lib/scraper.ts` in a test with no env vars crashes at import time** — before any test runs. The parser must be extracted into a module that imports *only* cheerio, never supabase. This is the non-obvious step; skipping it makes the tests impossible to run cleanly.
- The current parsing logic lives inside `scrapePage` (lines ~59–116), interleaved with the `fetch`. It maps `parsed.props.thread` → a `Deal`. That mapping is what moves to the pure function; the `fetch` stays behind.
- `Deal` and `HotPeriod` types are exported from `lib/scraper.ts`. After extraction they should live in (or be re-exported from) the new parse module so both the parser and scraper share them.
- No test runner, no `test` script, no CI workflow exist ([package.json](package.json) scripts are only `dev`/`build`/`start`/`lint`). `.gitignore` already ignores `/coverage`.
- `order_index` is assigned as `indexOffset + index` across pages by `scrapeTab`; the **per-page** parser only needs the within-page index, and the caller keeps applying the offset. Preserve that split so pagination ordering is unchanged.
- Per [AGENTS.md](AGENTS.md) this is a customised Next 16 — but this plan adds test tooling, not Next APIs, so no Next docs are required. Do check that the test runner you add doesn't collide with Next's build (it won't; tests run separately).

## Files to touch

| File | Change |
|---|---|
| `lib/parse-deals.ts` | NEW — pure parser extracted from `scrapePage`; imports only cheerio; owns `Deal`/`HotPeriod` types |
| `lib/scraper.ts` | Import `parseThreadsFromHtml` + types from `parse-deals`; `scrapePage` becomes fetch-then-parse; add sanity validation in `scrapeTabNow` |
| `lib/__fixtures__/hukd-hottest.html` | NEW — a captured real HUKD "hottest" page (kept intact) |
| `lib/__fixtures__/hukd-hot.html` | NEW — a captured "hot"/trending page (for `trending_for`) |
| `lib/parse-deals.test.ts` | NEW — fixture-driven parser tests |
| `package.json` | add `vitest` devDep + `"test": "vitest run"` script |
| `vitest.config.ts` | NEW — minimal config |
| `.github/workflows/ci.yml` | NEW (optional) — run build + test on push |

## Implementation order

### Step 1 — Extract the pure parser (no supabase, no fetch)

New file `lib/parse-deals.ts`. Move the `Deal` and `HotPeriod` type declarations here (cut them from `lib/scraper.ts`), and move the per-article mapping out of `scrapePage`:

```ts
import * as cheerio from 'cheerio'

export type HotPeriod = 'today' | 'week' | 'month'
export type Deal = { /* ...exactly the current shape from scraper.ts... */ }

/** Pure: HTML string -> Deal[] for a single page. No network, no DB, no env. */
export function parseThreadsFromHtml(
  html: string,
  tab: 'hot' | 'trending',
  period: HotPeriod,
  indexOffset = 0,
): Deal[] {
  const $ = cheerio.load(html)
  const deals: Deal[] = []
  $('article[id^="thread_"]').each((index, el) => {
    // ...move lines ~60–115 of scraper.ts here verbatim...
    // order_index: indexOffset + index
  })
  return deals
}
```

Keep the logic byte-for-byte identical to today's — this step is a pure refactor, not a behaviour change.

### Step 2 — Rewire `scraper.ts` to use it

In [lib/scraper.ts](lib/scraper.ts):
- Replace the deleted types/parse code. Import from the new module and **re-export the types** so existing importers (`app/api/scrape/hot/route.ts` imports `HotPeriod` from `@/lib/scraper`, and routes/components import `Deal`) keep compiling:
  ```ts
  import { parseThreadsFromHtml, type Deal, type HotPeriod } from './parse-deals'
  export type { Deal, HotPeriod }
  ```
- `scrapePage` shrinks to: build URL + cookie, `fetch`, `if (!res.ok) throw`, `const html = await res.text()`, `return parseThreadsFromHtml(html, tab, period, indexOffset)`.
- Leave `scrapeTab`, `scrapeTabNow`, `scrapeNow` otherwise intact (plus whatever [PLAN-feed-freshness](PLAN-feed-freshness.md)/[PLAN-supabase-security](PLAN-supabase-security.md) changed about the write client).

### Step 3 — Capture fixtures (do NOT hand-edit the JSON)

The `data-vue3` attribute is a large HTML-entity-encoded JSON blob; cheerio decodes it on `.attr()`. If you hand-trim and accidentally corrupt an entity, the fixture lies. Capture whole pages:

```bash
mkdir -p lib/__fixtures__
curl -s 'https://www.hotukdeals.com/hottest' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  -H 'Accept-Language: en-GB,en;q=0.9' -H 'Referer: https://www.hotukdeals.com/' \
  > lib/__fixtures__/hukd-hottest.html
curl -s 'https://www.hotukdeals.com/hot' -H 'User-Agent: Mozilla/5.0 ...' > lib/__fixtures__/hukd-hot.html
```

- If you must shrink them for repo size, delete **entire** `<article id="thread_…">…</article>` blocks, never edit inside one. Keep at least ~5 complete articles per fixture, including at least one with a `trending_for` chip in the hot/trending fixture.
- These are copies of public pages used only as test data. That's fine to commit.

### Step 4 — The parser test

New file `lib/parse-deals.test.ts`. Assert **invariants and ranges**, never exact counts (page content changes daily):

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseThreadsFromHtml } from './parse-deals'

const hottest = readFileSync(join(__dirname, '__fixtures__/hukd-hottest.html'), 'utf8')
const hot = readFileSync(join(__dirname, '__fixtures__/hukd-hot.html'), 'utf8')

describe('parseThreadsFromHtml', () => {
  const deals = parseThreadsFromHtml(hottest, 'hot', 'today')

  it('parses a plausible number of deals', () => {
    expect(deals.length).toBeGreaterThanOrEqual(5)
  })

  it('every deal has the required non-null fields', () => {
    for (const d of deals) {
      expect(d.id).toMatch(/^\d+$/)
      expect(d.title?.length ?? 0).toBeGreaterThan(0)
      expect(d.deal_url).toMatch(/^https?:\/\//)
      expect(typeof d.temperature).toBe('number')
      expect(d.tab).toBe('hot')
    }
  })

  it('image URLs, when present, match the expected CDN pattern', () => {
    const withImg = deals.filter(d => d.image_url)
    expect(withImg.length).toBeGreaterThan(0)         // pattern still resolving
    for (const d of withImg) {
      expect(d.image_url).toMatch(/^https:\/\/images\.hotukdeals\.com\/.+\/re\/202x202\/qt\/70\/.+\.jpg$/)
    }
  })

  it('most deals carry a price and a merchant', () => {
    const priced = deals.filter(d => d.price).length
    const withMerchant = deals.filter(d => d.merchant).length
    expect(priced / deals.length).toBeGreaterThan(0.4)
    expect(withMerchant / deals.length).toBeGreaterThan(0.4)
  })

  it('order_index respects the page offset', () => {
    const page2 = parseThreadsFromHtml(hottest, 'hot', 'today', 100)
    expect(page2[0].order_index).toBe(100)
  })

  it('trending page captures trending_for on at least one card', () => {
    const t = parseThreadsFromHtml(hot, 'trending', 'today')
    expect(t.some(d => d.trending_for)).toBe(true)
  })
})
```

### Step 5 — Wire the test runner

```bash
npm i -D vitest
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
})
```

Add to [package.json](package.json) scripts: `"test": "vitest run"` (and optionally `"test:watch": "vitest"`). Run `npm test` → green.

### Step 6 — Sanity validation in `scrapeTabNow` (catch silent partial corruption)

After parsing all pages, before writing, add a soft check. Keep the existing hard guard (`if (deals.length === 0) throw`), then:

```ts
const priced = deals.filter(d => d.price).length
const withMerchant = deals.filter(d => d.merchant).length
if (deals.length < 15 || priced / deals.length < 0.3 || withMerchant / deals.length < 0.3) {
  console.warn(
    `[scrape] degraded result for ${tab}/${period}: ` +
    `${deals.length} deals, ${priced} priced, ${withMerchant} with merchant — HUKD markup may have changed`
  )
}
```

This does **not** block the write (a genuinely quiet day could be low), but it emits a greppable warning in Vercel logs. Thresholds are deliberately loose — tune after watching real output for a few days. (A future enhancement could turn this into an email/push alert, but a log line is the right first step.)

### Step 7 — CI (optional but recommended)

New `.github/workflows/ci.yml` running on push/PR:

```yaml
name: CI
on: [push, pull_request]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://example.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: dummy-anon-key-for-build
```

The dummy env vars let `next build` succeed without secrets. `npm test` needs none, because the parser is env-free (that's the whole point of Step 1).

## Edge cases a weaker model will miss

- **The env-at-import crash (Step 1's reason for existing).** If you write the test to import `lib/scraper.ts` instead of `lib/parse-deals.ts`, it throws `supabaseUrl is required` at import and no test runs. The parser **must** live in a module with no supabase import. Verify by running `npm test` with **no `.env`** present — it must pass.
- **Don't assert exact deal counts or specific titles.** HUKD's front page changes hourly; tests that pin `expect(deals.length).toBe(63)` or a specific product name will flake daily. Assert ranges and invariants (as above). This is the difference between a test that protects you and one you'll delete in a week.
- **Fixture integrity.** The value of the fixture is that its `data-vue3` blobs are real. Capture via `curl`/save-as; don't reformat with an HTML prettifier (some will re-encode or drop attributes). If `cheerio.load` on the fixture yields zero articles, the capture was of a bot-block/consent page, not the deal list — re-capture (HUKD sometimes serves a 403/consent wall to datacenter IPs; capture from a normal browser's "Save Page As" if `curl` is blocked).
- **`__dirname` under Vitest.** Vitest supports CommonJS `__dirname` in test files by default; if the project is ESM-strict and `__dirname` is undefined, use `import.meta.dirname` (Node 20+) or `fileURLToPath(new URL('./__fixtures__/…', import.meta.url))`. Pick whichever resolves; don't hard-code an absolute path.
- **Re-exporting types.** Several files import `Deal`/`HotPeriod` from `@/lib/scraper`. If you move the types without re-exporting them from `scraper.ts`, those imports break the build. The `export type { Deal, HotPeriod }` line in Step 2 is mandatory.
- **The sanity thresholds must not throw.** A hard `throw` on "degraded" would let a genuinely thin scrape wipe the feed (well — with feed-freshness's atomic replace it wouldn't wipe, but it would refuse to update on a quiet day). Warn, don't throw. The only hard failure stays the existing `length === 0` guard.
- **Keep `scrapePage`'s `if (!res.ok) throw` on the fetch side**, not in the parser — the parser has no `res`. Network failures and parse failures are different concerns; don't merge them.

## Acceptance criteria

1. `npm test` passes **with no `.env` file present** (proves the parser is env-free).
2. Parser refactor is behaviour-preserving: a scrape (`/api/scrape/hot?period=today` with the cron secret) returns the same shape/counts as before the refactor; deals still render with images, prices, merchants, and `trending_for` on the trending tab.
3. **The test actually catches regressions:** temporarily change the selector in `parse-deals.ts` from `article[id^="thread_"]` to `article[id^="xxx_"]` → `npm test` fails on the "plausible number of deals" assertion. Revert.
4. Degraded-scrape warning: temporarily point a fixture-based unit call (or a local scrape against a trimmed fixture) at data with few prices → the `[scrape] degraded result …` warning is logged; the write is **not** blocked.
5. `npm run build` still passes and all existing `@/lib/scraper` imports (`Deal`, `HotPeriod`, `scrapeTabNow`, `scrapeNow`) resolve.
6. (If CI added) the workflow is green on a pushed branch.

## Out of scope

- Turning the degraded-scrape warning into a real alert channel (email/push) — log line first; revisit if it fires often.
- Testing the *write* path (`scrapeTabNow`/`replace_deals`) — that needs a DB and belongs with [PLAN-feed-freshness](PLAN-feed-freshness.md)'s SQL-level acceptance checks. This plan tests parsing only.
- Making the image-URL template or `trending_for` selector "self-healing" — the test + warning make breakage *visible*; auto-recovery is a bigger project.
