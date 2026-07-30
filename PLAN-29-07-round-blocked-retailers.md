# PLAN: Blocked retailers — silent failures, case-duplicate entries, and a filter that misses every sub-brand

**Rank: 4 of 5.**

## Goal

"Blocked retailers" is the only content-preference feature in the app, and all three of its layers
are subtly wrong. It is also the only feature that still uses raw `fetch` with no error handling,
which the rest of the app moved away from in commit `03d97c2`.

### Bug 1 — the filter only matches the merchant name *exactly*

```ts
// app/api/deals/route.ts:73-79
if (blockedMerchants.length > 0 && d.merchant &&
    blockedMerchants.includes(d.merchant.toLowerCase().trim())) return false
```

Blocking `amazon` hides deals from `Amazon` — and nothing else. From the committed fixtures, real
HUKD merchant strings include `ASDA Groceries`, `EE Tech & Gaming`, `Playstation Store`,
`Sky Digital`, `Appliances Direct`, `Foot Locker`. Block `asda` and you still get every
`ASDA Groceries` deal. On the live site `Amazon Warehouse`, `Amazon US` and `Amazon Prime` are all
distinct merchant strings, so blocking Amazon does roughly nothing.

### Bug 2 — the modal stores duplicates because it dedupes against the wrong casing

[app/api/preferences/route.ts:30](app/api/preferences/route.ts) lowercases on write:
```ts
const normalised = blocked_merchants.map((m: string) => m.toLowerCase().trim())
```
[components/BlockedMerchantsModal.tsx:32](components/BlockedMerchantsModal.tsx) dedupes against the
**raw** input:
```ts
if (!name || blocked.includes(name)) { setInput(''); return }
```

So: add `Amazon` → stored as `amazon`. Reopen the modal, type `Amazon` again →
`["amazon"].includes("Amazon")` is `false` → it is added again → the array becomes
`["amazon","amazon"]`. `blocked_merchants` is a plain `text[]`
([supabase/migrations/add_user_preferences.sql:3](supabase/migrations/add_user_preferences.sql))
with no uniqueness, so the duplicate persists. Worse, `remove()` filters by exact string, so
removing one leaves the other — and the chips render with React `key={merchant}`, so two identical
keys collide.

### Bug 3 — every request in the modal fails silently

```ts
// BlockedMerchantsModal.tsx:14-17
fetch('/api/preferences').then(r => r.json())
  .then(d => { setBlocked(d.blocked_merchants ?? []); setLoading(false) })
```

No `res.ok` check, no `.catch`. On a 401 the body is `{ error: 'Unauthorized' }`, so
`d.blocked_merchants` is `undefined` → the list renders as **"No retailers blocked yet"** for a user
who has blocked ten retailers. The subsequent `PATCH` in `save()` (lines 19-28) also ignores its
response, so the chip appears in the UI while nothing is persisted. A rejected promise here is an
unhandled rejection, not an error message.

Meanwhile the rest of the app routes everything through `fetchJson`/`AuthError`
([lib/api.ts](lib/api.ts)) precisely so a dead session bounces to `/auth`.

### Bug 4 — the chips display the normalised text

Because the server lowercases, the UI shows `ebay`, `marks & spencer`, `ee tech & gaming`. Scruffy,
and it makes Bug 2 invisible to the user.

### After this plan

- Blocking `amazon` hides `Amazon`, `Amazon Warehouse` and `Amazon US`, but not `Marks & Spencer`.
- Retailers are stored with their display casing and deduped case-insensitively.
- Every request checks its response; a dead session bounces to `/auth` like everywhere else.
- The filtering logic is a pure, tested function instead of an inline conditional in a route.

## Exact files to touch

| File | Change |
|------|--------|
| `lib/filter-deals.ts` | **New.** Pure `isMerchantBlocked` + `filterDeals` |
| `lib/filter-deals.test.ts` | **New.** Unit tests |
| [app/api/deals/route.ts](app/api/deals/route.ts) | Use `filterDeals` instead of the inline conditional |
| [app/api/preferences/route.ts](app/api/preferences/route.ts) | Store display casing; dedupe case-insensitively; validate |
| [components/BlockedMerchantsModal.tsx](components/BlockedMerchantsModal.tsx) | `fetchJson`/`AuthError`; case-insensitive dedupe; error UI; fix the lint error on line 64 |

No schema change. Existing rows are already lowercase, and the new comparison lowercases both sides,
so they keep working — they just render in lowercase until re-added.

## Implementation order

### Step 1 — `lib/filter-deals.ts` (new)

```ts
/**
 * Does `merchant` fall under the blocked term `term`?
 *
 * Exact match, or the merchant NAME STARTS WITH the term followed by a space —
 * so "amazon" blocks "Amazon Warehouse" and "asda" blocks "ASDA Groceries",
 * while "ao" (a real UK retailer on HUKD) does not accidentally match anything
 * that merely contains those two letters.
 *
 * Deliberately NOT a substring match: `"currys".includes("ur")` style false
 * positives would silently hide deals the user never asked to block, which is
 * far worse than an over-narrow filter they can widen by adding another term.
 */
export function isMerchantBlocked(merchant: string | null, blockedTerms: string[]): boolean {
  if (!merchant || blockedTerms.length === 0) return false
  const name = merchant.toLowerCase().trim()
  return blockedTerms.some((raw) => {
    const term = raw.toLowerCase().trim()
    if (!term) return false
    return name === term || name.startsWith(term + ' ')
  })
}

type FilterableDeal = { id: string | number; merchant: string | null }

/** Drop deals the user has dismissed or whose merchant they have blocked. */
export function filterDeals<T extends FilterableDeal>(
  deals: T[],
  dismissedIds: Iterable<string>,
  blockedTerms: string[],
): T[] {
  const dismissed = new Set(Array.from(dismissedIds, String))
  return deals.filter(
    (d) => !dismissed.has(String(d.id)) && !isMerchantBlocked(d.merchant, blockedTerms),
  )
}
```

### Step 2 — `lib/filter-deals.test.ts` (new)

```ts
import { describe, it, expect } from 'vitest'
import { isMerchantBlocked, filterDeals } from './filter-deals'

describe('isMerchantBlocked', () => {
  it('matches the merchant exactly, ignoring case', () => {
    expect(isMerchantBlocked('Amazon', ['amazon'])).toBe(true)
    expect(isMerchantBlocked('amazon', ['Amazon'])).toBe(true)
  })
  it('matches sub-brands that extend the term', () => {
    expect(isMerchantBlocked('Amazon Warehouse', ['amazon'])).toBe(true)
    expect(isMerchantBlocked('ASDA Groceries', ['asda'])).toBe(true)
    expect(isMerchantBlocked('EE Tech & Gaming', ['ee'])).toBe(true)
    expect(isMerchantBlocked('Playstation Store', ['playstation'])).toBe(true)
  })
  it('does not match on an incidental substring', () => {
    expect(isMerchantBlocked('Marks & Spencer', ['ao'])).toBe(false)
    expect(isMerchantBlocked('Currys', ['ur'])).toBe(false)
    expect(isMerchantBlocked('Amazonia Ltd', ['amazon'])).toBe(false)
  })
  it('handles null merchants and empty term lists', () => {
    expect(isMerchantBlocked(null, ['amazon'])).toBe(false)
    expect(isMerchantBlocked('Amazon', [])).toBe(false)
    expect(isMerchantBlocked('Amazon', ['', '  '])).toBe(false)
  })
})

describe('filterDeals', () => {
  const deals = [
    { id: '1', merchant: 'Amazon' },
    { id: '2', merchant: 'Lidl' },
    { id: 3, merchant: 'ASDA Groceries' },
    { id: '4', merchant: null },
  ]
  it('drops dismissed ids regardless of string/number type', () => {
    expect(filterDeals(deals, ['3'], []).map(d => d.id)).toEqual(['1', '2', '4'])
  })
  it('drops blocked merchants and their sub-brands', () => {
    expect(filterDeals(deals, [], ['amazon', 'asda']).map(d => d.id)).toEqual(['2', '4'])
  })
  it('keeps deals with no merchant', () => {
    expect(filterDeals(deals, [], ['amazon']).some(d => d.merchant === null)).toBe(true)
  })
})
```

> The `id: 3` (number) case is not academic. `deals.id` is a text column but Supabase can return it
> as either depending on the column type, which is exactly why
> [app/api/deals/route.ts:69-72](app/api/deals/route.ts) already wraps everything in `String()`.
> Keep that behaviour.

### Step 3 — use it in the route

In [app/api/deals/route.ts](app/api/deals/route.ts), replace lines 71-81:

```ts
const deals = filterDeals(candidates, dismissedSet, blockedMerchants)
```

and drop the now-unused `dismissedIds`→`dismissedSet` intermediate if you prefer — `filterDeals`
takes any iterable of ids, so `dismissedRows?.map(r => r.deal_id) ?? []` can go straight in.

### Step 4 — `app/api/preferences/route.ts`: store display casing, dedupe properly

Replace the `PATCH` body's normalisation (line 30) with:

```ts
if (!Array.isArray(blocked_merchants)) {
  return NextResponse.json({ error: 'blocked_merchants must be an array' }, { status: 400 })
}

// Keep the user's casing for display; dedupe on the lowercased form, which is
// what isMerchantBlocked() compares against. Bound the list so a bad client
// can't write an unbounded array into the row.
const seen = new Set<string>()
const cleaned: string[] = []
for (const entry of blocked_merchants) {
  if (typeof entry !== 'string') continue
  const display = entry.trim().slice(0, 60)
  const key = display.toLowerCase()
  if (!display || seen.has(key)) continue
  seen.add(key)
  cleaned.push(display)
}
if (cleaned.length > 100) {
  return NextResponse.json({ error: 'Too many blocked retailers (max 100)' }, { status: 400 })
}

const { error } = await client
  .from('user_preferences')
  .upsert({ user_id: user.id, blocked_merchants: cleaned, updated_at: new Date().toISOString() })
```

> The `upsert` here has **no `onConflict`**, which works only because `user_id` is the table's
> primary key ([add_user_preferences.sql:2](supabase/migrations/add_user_preferences.sql)). That is
> correct as-is — do not add `onConflict: 'user_id'`, and do not "fix" it by copying the pattern from
> [app/api/save/route.ts](app/api/save/route.ts), which needs it because `saved` has a synthetic key.

### Step 5 — `components/BlockedMerchantsModal.tsx`

Four changes:

**(a) Use `fetchJson` and handle failure.** Replace the load effect (lines 13-17):

```ts
const [loadError, setLoadError] = useState<string | null>(null)

useEffect(() => {
  let cancelled = false
  fetchJson<{ blocked_merchants: string[] }>('/api/preferences')
    .then(d => { if (!cancelled) { setBlocked(d.blocked_merchants ?? []); setLoading(false) } })
    .catch(err => {
      if (cancelled) return
      if (err instanceof AuthError) { router.push('/auth'); return }
      setLoadError('Could not load your blocked retailers')
      setLoading(false)
    })
  return () => { cancelled = true }
}, [router])
```

with `import { fetchJson, AuthError } from '@/lib/api'` and `useRouter` from `next/navigation`.

**(b) Roll back a failed save.** Replace `save` (lines 19-28):

```ts
const save = async (updated: string[], previous: string[]) => {
  setSaving(true)
  try {
    await fetchJson('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked_merchants: updated }),
    })
    onChanged()
  } catch (err) {
    if (err instanceof AuthError) { router.push('/auth'); return }
    setBlocked(previous)          // undo the optimistic update
    setLoadError('Could not save — try again')
  } finally {
    setSaving(false)
  }
}
```

and update both call sites to pass the previous list:
```ts
const add = () => {
  const name = input.trim()
  // Case-insensitive dedupe — the server stores display casing, so a raw
  // includes() check would let "Amazon" through when "amazon" is already stored.
  const key = name.toLowerCase()
  if (!name || blocked.some(m => m.toLowerCase() === key)) { setInput(''); return }
  const previous = blocked
  const updated = [...blocked, name]
  setBlocked(updated)
  setInput('')
  save(updated, previous)
  inputRef.current?.focus()
}

const remove = (merchant: string) => {
  const previous = blocked
  const updated = blocked.filter(m => m !== merchant)
  setBlocked(updated)
  save(updated, previous)
}
```

**(c) Render the error.** Above the chip list:
```tsx
{loadError && (
  <p className="text-xs text-red-400 pt-2">{loadError}</p>
)}
```

**(d) Fix the ESLint error on line 64.** `won't` → `won&apos;t`:
```tsx
<p className="text-xs text-[#8a8f98] mb-3">Deals from these retailers won&apos;t appear in your feed.</p>
```

Also update the copy to describe the new matching, since it is no longer an exact match:
```tsx
placeholder="e.g. Amazon, Argos…"
```
stays, but add under the input:
```tsx
<p className="text-[11px] text-[#8a8f98]/60 mt-2">Matches the retailer and its sub-brands — “Amazon” also blocks “Amazon Warehouse”.</p>
```

## Edge cases found while exploring

1. **Existing stored values are already lowercase.** After this change they still filter correctly
   (both sides are lowercased in `isMerchantBlocked`) but render as `ebay` until the user removes and
   re-adds them. Do **not** write a backfill migration to title-case them — `eBay`, `ao` and
   `EE Tech & Gaming` all have casing no algorithm will guess right.
2. **`startsWith(term + ' ')` and not `startsWith(term)`.** Without the trailing space, blocking
   `ao` would hide `ao.com`-unrelated merchants like… nothing in today's fixture, but blocking `ee`
   would hide `eBay`-adjacent names, and blocking `am` would hide `Amazon`. The space is what makes
   this a word-boundary rule rather than a prefix rule.
3. **`&` in merchant names.** `Marks & Spencer` and `EE Tech & Gaming` both contain `&`. Nothing here
   HTML-escapes the term, and nothing needs to — it goes into a JSON body and a Postgres `text[]`,
   never into markup as raw HTML. Do not add escaping.
4. **The modal never refetches after `onChanged()`.** That is intentional and stays that way: the
   local state *is* the source of truth while the modal is open, and refetching would fight the
   optimistic update. The rollback in (b) is what keeps them consistent.
5. **`blocked.length === 0 && !saving`** guards the "No retailers blocked yet" message
   ([line 91](components/BlockedMerchantsModal.tsx)). Keep the `!saving` part — without it the empty
   message flashes between removing the last chip and the PATCH resolving.
6. **The filter runs *after* the 150-row `.limit()`** in
   [app/api/deals/route.ts:52](app/api/deals/route.ts). Blocking a high-volume retailer therefore
   shrinks the feed rather than pulling in more deals from deeper in the table. With 3 pages × 30
   deals = **90 rows per tab/period** the limit is not currently binding, so this is not a live bug —
   but if `PAGES_TO_SCRAPE` is ever raised above 5, the filter must move into the SQL query. Leave a
   comment saying so.
7. **`user_preferences` has RLS with a `for all` policy** keyed on `auth.uid() = user_id`
   ([add_user_preferences.sql:9-13](supabase/migrations/add_user_preferences.sql)), and the route uses
   the cookie-scoped client. The `upsert` therefore cannot write another user's row even if
   `user_id` were spoofed. No extra check needed.

## Acceptance criteria

1. `npm test` — the new `filter-deals` suite passes.
2. `npx eslint .` — `BlockedMerchantsModal.tsx` no longer reports
   `react/no-unescaped-entities` (the total error count drops from 7 to 6).
3. `npm run build` — clean.
4. **Sub-brands are blocked.** Add `amazon` in the modal. The Hot feed drops every deal whose
   merchant starts with "Amazon" — verify against a feed that currently shows `Amazon` deals (the
   trending fixture has 9 of 30).
5. **No false positives.** With `ao` blocked, `Marks & Spencer`, `Currys` and `Argos` deals all still
   appear.
6. **No duplicate entries.** Add `Amazon`, close the modal, reopen it, type `amazon`, press Enter.
   The list still shows exactly one chip. Confirm in SQL:
   ```sql
   select blocked_merchants from public.user_preferences;
   ```
   → `{Amazon}`, not `{Amazon,amazon}`.
7. **Casing is preserved.** The chip reads `Amazon`, not `amazon`.
8. **Failures are visible.** In DevTools, block the `/api/preferences` request (Network →
   right-click → Block request URL) and add a retailer. An error message appears and the chip is
   removed again — it does not sit there pretending to be saved.
