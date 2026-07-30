# PLAN: Fix malformed prices — `£2.5`, `£11195` and `£0` on roughly a quarter of all cards

**Rank: 3 of 5.**

## Goal

The price is the single most important number on a deal card, and it is currently rendered by
string-concatenating whatever number HotUKDeals sends:

```ts
// lib/parse-deals.ts:91
const price = thread.price != null ? `£${thread.price}` : null
```

That produces three distinct classes of wrong output. These are not hypotheticals — this is the
actual parsed output of the committed fixture
[lib/__fixtures__/hukd-hottest.html](lib/__fixtures__/hukd-hottest.html), which is a real captured
HUKD page:

```
["£17.99","£369.95","£0.65","£11195","£10","£2.5","£17.99","£3.99","£0","£7.99",
 "£10.5","£7.99","£4.92","£0","£0","£2.45","£984","£43.99","£0","£0.79",
 "£149","£6.99","£18","£0","£2.5","£224","£499.98","£779","£240","£2.69"]
```

| Bug | Examples on that one page | Count |
|-----|---------------------------|-------|
| **Truncated pence** — `1.50` arrives as the number `1.5` | `£2.5`, `£10.5`, `£2.5` | 3 / 30 |
| **No thousands separator** | `£11195` (should be `£11,195`) | 1 / 30 |
| **`£0` rendered literally** — HUKD uses `0` for free / no-fixed-price deals | Marks & Spencer, Epic Games ×2, Iceland, Xbox | 4 / 30 |

**8 of 30 cards — 27% — show a malformed price.** The trending fixture is the same story
(`£2.1`, `£37.5`, `£3999`).

`£0` is the worst of the three: a genuinely free Epic Games giveaway reads as if it costs nothing
*because the app failed to load a price*, which is indistinguishable from a scraper bug.

### After this plan

- `£2.50`, `£11,195`, `FREE`.
- The formatting is a pure, unit-tested function, so the next HUKD price-shape surprise gets a test
  instead of a bug report.

## Exact files to touch

| File | Change |
|------|--------|
| `lib/format-price.ts` | **New.** The pure formatter |
| `lib/format-price.test.ts` | **New.** Unit tests |
| [lib/parse-deals.ts](lib/parse-deals.ts) | Use it at line 91 |
| [components/DealCard.tsx](components/DealCard.tsx) | Style `FREE` distinctly from a `£` amount |
| [components/SavedFeed.tsx](components/SavedFeed.tsx) | Same styling, for consistency |
| [lib/parse-deals.test.ts](lib/parse-deals.test.ts) | Tighten the price assertion against the fixture |

No schema change. `deals.price` stays a text column.

## Implementation order

### Step 1 — `lib/format-price.ts` (new)

```ts
/**
 * Render a HotUKDeals price for display.
 *
 * `thread.price` arrives as a JSON number, so trailing zeros are already gone by
 * the time we see it: £1.50 is the number 1.5, and £2.00 is the number 2. It can
 * also be a string on some thread types, hence the Number() coercion.
 *
 * HUKD uses 0 to mean "no fixed price" — free giveaways (Epic Games), vouchers,
 * and in-store offers all come through as 0. Rendering "£0" reads as a scraper
 * failure, so 0 becomes "FREE".
 *
 * Returns null when there is nothing sensible to show; callers render no price
 * chip at all in that case.
 */
export function formatPrice(raw: number | string | null | undefined): string | null {
  if (raw == null) return null

  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[£,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  if (n === 0) return 'FREE'

  // Whole pounds show no pence (£149, not £149.00); anything with pence shows
  // exactly two (£2.50, not £2.5). Thousands separators throughout.
  const hasPence = Math.round(n * 100) % 100 !== 0
  return '£' + n.toLocaleString('en-GB', {
    minimumFractionDigits: hasPence ? 2 : 0,
    maximumFractionDigits: 2,
  })
}
```

> **`toLocaleString('en-GB')` is safe on both the Node runtime and the browser here** — Node 20+
> (CI pins `node-version: 20`) ships full ICU by default. Do not swap it for a manual regex.

### Step 2 — `lib/format-price.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest'
import { formatPrice } from './format-price'

describe('formatPrice', () => {
  it('pads truncated pence', () => {
    expect(formatPrice(2.5)).toBe('£2.50')
    expect(formatPrice(10.5)).toBe('£10.50')
    expect(formatPrice(2.1)).toBe('£2.10')
  })
  it('leaves whole pounds without pence', () => {
    expect(formatPrice(149)).toBe('£149')
    expect(formatPrice(18)).toBe('£18')
  })
  it('adds thousands separators', () => {
    expect(formatPrice(11195)).toBe('£11,195')
    expect(formatPrice(3999)).toBe('£3,999')
    expect(formatPrice(1234.5)).toBe('£1,234.50')
  })
  it('renders 0 as FREE', () => {
    expect(formatPrice(0)).toBe('FREE')
  })
  it('keeps two-decimal prices intact', () => {
    expect(formatPrice(17.99)).toBe('£17.99')
    expect(formatPrice(0.65)).toBe('£0.65')
    expect(formatPrice(499.98)).toBe('£499.98')
  })
  it('accepts string input', () => {
    expect(formatPrice('17.99')).toBe('£17.99')
    expect(formatPrice('£1,234.50')).toBe('£1,234.50')
  })
  it('returns null for absent or nonsense values', () => {
    expect(formatPrice(null)).toBeNull()
    expect(formatPrice(undefined)).toBeNull()
    expect(formatPrice('n/a')).toBeNull()
    expect(formatPrice(-5)).toBeNull()
  })
  it('rounds sub-penny float noise rather than showing three decimals', () => {
    expect(formatPrice(19.999)).toBe('£20')
    expect(formatPrice(4.005)).toBe('£4.01')
  })
})
```

> The last case is the one to get right. `4.005` must not become `£4.005`. `maximumFractionDigits: 2`
> handles it; the `hasPence` check uses `Math.round(n * 100) % 100` so `19.999` is classified as
> whole pounds and renders `£20`, not `£20.00`.

### Step 3 — wire it into the parser

In [lib/parse-deals.ts](lib/parse-deals.ts), add the import and replace line 91:

```ts
import { formatPrice } from './format-price'
// ...
const price = formatPrice(thread.price)
```

Delete nothing else — `thread.price` is already typed `number | string` on the `thread` shape
declaration at [parse-deals.ts:65](lib/parse-deals.ts), which is why `formatPrice` accepts both.

### Step 4 — render `FREE` as a badge, not as a price

`FREE` in the same `text-sm font-bold text-white` slot as `£17.99` reads oddly. In
[components/DealCard.tsx:112-122](components/DealCard.tsx), replace the price span:

```tsx
{deal.price && (
  deal.price === 'FREE' ? (
    <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-bold ring-1 ring-emerald-500/20 tracking-wide">
      FREE
    </span>
  ) : (
    <span className="text-sm font-bold text-white">{deal.price}</span>
  )
)}
```

Apply the identical change in [components/SavedFeed.tsx:72-79](components/SavedFeed.tsx).

> Emerald is already the app's "good outcome" colour (save / right swipe) per the house style in
> CLAUDE.md, so this introduces no new hue. Do **not** reach for green-500 or a new token.

### Step 5 — tighten the fixture test

In [lib/parse-deals.test.ts](lib/parse-deals.test.ts), add to the existing `describe`:

```ts
it('formats every price as FREE or a well-formed sterling amount', () => {
  for (const d of deals) {
    if (d.price === null) continue
    expect(d.price).toMatch(/^(FREE|£\d{1,3}(,\d{3})*(\.\d{2})?)$/)
  }
})
```

That regex rejects every one of today's bad outputs: `£2.5` (one decimal), `£11195` (missing comma),
`£0` (zero must be `FREE`).

## Edge cases found while exploring

1. **Existing DB rows keep the old strings until the next scrape.** `deals` is fully replaced by
   `replace_deals` on each scrape ([supabase/migrations/replace_deals_fn.sql](supabase/migrations/replace_deals_fn.sql)),
   so the feed self-corrects within 30 minutes. No backfill needed.
2. **`saved.deal_data` snapshots keep the old string forever.** [app/api/save/route.ts:17](app/api/save/route.ts)
   stores the whole deal object as JSON at save time. Deals saved before this change will still show
   `£2.5` in the Saved tab. That is acceptable (it is a historical snapshot, and the point of the
   snapshot is that it doesn't change), but the `FREE` branch in `SavedFeed` must therefore also
   tolerate a legacy `"£0"` string — it will render it as an ordinary price, which is the old
   behaviour, not a new bug. Do not write a migration for this.
3. **`n < 0` returns null, not a negative price.** HUKD has never sent one, but a `-1` sentinel is a
   plausible future encoding for "price hidden", and `£-1` on a card would be worse than no price.
4. **Don't use `Intl.NumberFormat(..., { style: 'currency', currency: 'GBP' })`.** It always emits
   two fraction digits *or* none depending on locale rules you don't control, and it would render
   `£149.00`. The manual `£` prefix with explicit digit bounds is deliberate.
5. **`price` stays a string in the DB and in the `Deal` type.** Do not "improve" this into a numeric
   column — `saved.deal_data` is untyped JSON written by the client, and a type change there would
   silently break every existing saved row. If you ever do want numeric prices, that is a separate
   migration with a backfill, not part of this plan.
6. **The `thread.price` field can be absent entirely** (not just null) on some thread types — the
   optional-property access at [parse-deals.ts:65](lib/parse-deals.ts) yields `undefined`, which
   `formatPrice` handles via the `raw == null` check. Keep that check loose (`==`, not `===`).

## Acceptance criteria

1. `npm test` — the new `format-price` suite passes and the tightened fixture assertion in
   `parse-deals.test.ts` passes. That second one is the real proof: it runs against a **real
   captured HUKD page** and currently fails on 8 of 30 deals.
2. `npm run build` — clean.
3. Ad-hoc check against the fixture (paste into a scratch file and run with `npx tsx`):
   ```ts
   import { readFileSync } from 'node:fs'
   import { parseThreadsFromHtml } from './lib/parse-deals'
   const deals = parseThreadsFromHtml(readFileSync('lib/__fixtures__/hukd-hottest.html','utf8'), 'hot', 'today')
   console.log(deals.map(d => d.price).join(' '))
   ```
   Expected: `£17.99 £369.95 £0.65 £11,195 £10 £2.50 £17.99 £3.99 FREE £7.99 £10.50 …`
   — specifically `£11,195` (was `£11195`), `£2.50` (was `£2.5`), `FREE` (was `£0`).
4. In the running app, force a rescrape (see the acceptance steps in
   [PLAN-29-07-round-freshness-lie.md](PLAN-29-07-round-freshness-lie.md)) and confirm on device
   that no card shows a single-decimal price, and that free deals show a green `FREE` pill rather
   than `£0`.
