# PLAN: Client resilience — stop silently showing an empty feed on error, handle expired sessions, roll back failed swipes

**Rank: 4 of 5.**

## Goal

Every client fetch in the app assumes success. None check `res.ok`; all destructure `data.deals`/`data.saved` blindly; the swipe handlers are fire-and-forget. The result is a set of failure modes that all look identical to the user — **an empty feed that says "All caught up"** — even when the real cause is a 500, a network drop, or an expired login.

Concretely, verified in the code:
- [components/DealFeed.tsx](components/DealFeed.tsx) `fetchDeals`/`refresh`: `const data = await res.json(); setDeals(data.deals ?? [])`. On a 401 (session expired) or 500, `data.deals` is `undefined` → `setDeals([])` → the "All caught up" empty state renders, with a Refresh button that will keep failing. The user has no idea they've been logged out.
- [components/SavedFeed.tsx](components/SavedFeed.tsx) `fetchSaved`/`refresh`: identical pattern → "No saved deals" on any error.
- `handleDismiss` optimistically removes the card, then POSTs and ignores the result. If the POST fails, the card is gone from the UI but **not** persisted, so it reappears on next load — confusing, and the user thinks they dismissed it.
- `handleSave` awaits the POST but ignores its status; the green "saved" flash in [components/DealCard.tsx](components/DealCard.tsx) fires **before** and **regardless of** the POST result, so a failed save still looks successful.
- [components/PullToRefresh.tsx](components/PullToRefresh.tsx) `handleTouchEnd` does `await onRefresh()` with no `try/finally`. If `onRefresh` rejects (network error), `setRefreshing(false)` never runs and the spinner **spins forever**.

After this plan: a failed load shows a real error state with a working Retry; an expired session sends the user to `/auth` instead of faking an empty feed; a failed dismiss/save is rolled back and surfaced; the pull-to-refresh spinner always resets.

## Context you must know (verified against the code on 2026-07-09)

- Auth model: [proxy.ts](proxy.ts) redirects unauthenticated **navigations** to `/auth`, but it does **not** run on client `fetch()` calls to `/api/*` (its matcher excludes `api`). So when the Supabase session cookie expires mid-session, the next `fetch('/api/deals')` returns `401 { error: 'Unauthorized' }` (see [app/api/deals/route.ts:10](app/api/deals/route.ts)) and the client must handle that itself.
- The browser Supabase client already exists at [lib/supabase-browser.ts](lib/supabase-browser.ts) and is used in [components/HomePage.tsx](components/HomePage.tsx) for sign-out. Use `createClient()` from there + `useRouter().push('/auth')` to bounce on 401.
- All API routes return JSON `{ error }` with the proper status on failure, and set `Cache-Control: no-store`. So status-code checks are reliable; you do not need to parse error bodies except to display a message.
- `handleDismiss` currently updates state with `setDeals(prev => prev.filter(...))` — to roll back you need the removed deal and its position, or you refetch. Refetch is simpler and always consistent (see Edge cases).
- **Ordering:** independent of the other plans. If [PLAN-feed-freshness](PLAN-feed-freshness.md) is done, `fetchDeals` will also read `last_scraped_at`/`refreshing` from the response and schedule one re-fetch — keep that; just add the error handling around it and make sure a persistent 500 does **not** turn that single re-fetch into a loop.

## Files to touch

| File | Change |
|---|---|
| `lib/api.ts` | NEW — `fetchJson()` helper: checks `res.ok`, parses JSON safely, tags 401s |
| `components/DealFeed.tsx` | error + auth handling in `fetchDeals`/`refresh`; roll back failed dismiss; honour save result |
| `components/SavedFeed.tsx` | error + auth handling in `fetchSaved`/`refresh`; roll back failed unsave |
| `components/DealCard.tsx` | `onSave` returns a promise; show the green flash only on success |
| `components/PullToRefresh.tsx` | wrap `onRefresh()` in `try/finally` so the spinner always resets |

## Implementation order

### Step 1 — A tiny fetch helper

New file `lib/api.ts`:

```ts
export class AuthError extends Error {}

/** GET/POST JSON with real error handling. Throws AuthError on 401 so callers can bounce to /auth. */
export async function fetchJson<T = any>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: 'no-store', ...init })
  if (res.status === 401) throw new AuthError('Unauthorized')
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { const body = await res.json(); if (body?.error) msg = body.error } catch { /* non-JSON body */ }
    throw new Error(msg)
  }
  try {
    return await res.json() as T
  } catch {
    return {} as T   // e.g. 204 No Content
  }
}
```

### Step 2 — DealFeed: error state, auth bounce, no more silent empties

In [components/DealFeed.tsx](components/DealFeed.tsx):

1. Import `useRouter` from `next/navigation`, and `fetchJson`, `AuthError` from `@/lib/api`. Add state: `const [error, setError] = useState<string | null>(null)`.
2. Rewrite `fetchDeals`:

```ts
const fetchDeals = useCallback(async (p?: 'today' | 'week') => {
  const activePeriod = p ?? period
  setLoading(true)
  setError(null)
  try {
    const data = await fetchJson<{ deals: Deal[] }>(`/api/deals?tab=${tab}&period=${activePeriod}`)
    setDeals(data.deals ?? [])
  } catch (err) {
    if (err instanceof AuthError) { router.push('/auth'); return }
    setError(err instanceof Error ? err.message : 'Could not load deals')
  } finally {
    setLoading(false)
  }
}, [tab, period, router])
```

3. `refresh` (used by pull-to-refresh): same try/catch, but **don't** toggle the full-screen `loading` skeleton — just update deals or set `error`. On `AuthError`, `router.push('/auth')`.
4. Render an error state when `!loading && error && deals.length === 0`: a short message plus a Retry button that calls `fetchDeals()`. Put it above the existing "All caught up" branch so a genuine error never masquerades as an empty feed. Keep "All caught up" only for the true `error === null && deals.length === 0` case.

### Step 3 — DealFeed: roll back a failed dismiss, honour save result

```ts
const handleDismiss = async (id: string) => {
  const prev = deals
  setDeals(cur => cur.filter(d => d.id !== id))   // optimistic
  try {
    await fetchJson('/api/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: id }),
    })
  } catch (err) {
    if (err instanceof AuthError) { router.push('/auth'); return }
    setDeals(prev)                 // roll back — the deal is still live
    setError('Could not dismiss — try again')
  }
}

const handleSave = async (deal: Deal): Promise<boolean> => {
  try {
    await fetchJson('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: deal.id, deal }),
    })
    return true
  } catch (err) {
    if (err instanceof AuthError) { router.push('/auth'); return false }
    setError('Could not save — try again')
    return false
  }
}
```

### Step 4 — DealCard: green flash only on a real save

In [components/DealCard.tsx](components/DealCard.tsx), change the `onSave` prop type to `(deal: Deal) => Promise<boolean>` and make `save()` await it before flashing:

```ts
const save = async () => {
  vibrate([10, 50, 10])
  animate(x, 0, { type: 'spring', damping: 20, stiffness: 300 })
  const ok = await onSave(deal)
  if (ok) {
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1000)
  }
}
```

The bounce-back animation can stay immediate (good tactile feedback), but the success colour now reflects reality.

### Step 5 — SavedFeed: same treatment

In [components/SavedFeed.tsx](components/SavedFeed.tsx): apply Step 2's pattern to `fetchSaved`/`refresh` (error state + `AuthError` → `/auth`), and Step 3's rollback to `handleUnsave` (capture `prev`, restore on failure). Render an error+Retry block instead of letting an error fall through to the "No saved deals" empty state.

### Step 6 — PullToRefresh: never leave the spinner stuck

In [components/PullToRefresh.tsx](components/PullToRefresh.tsx) `handleTouchEnd`:

```ts
if (pullY >= THRESHOLD) {
  setPullY(0)
  setRefreshing(true)
  try {
    await onRefresh()
  } finally {
    setRefreshing(false)
  }
} else {
  setPullY(0)
}
```

Now `onRefresh` throwing (which it no longer will after Step 2, but defence in depth) still resets the spinner.

## Edge cases a weaker model will miss

- **Roll back by restoring the snapshot, not by re-inserting one card.** Framer Motion's `layout`/`AnimatePresence` makes splicing a single card back at its old index janky. Capturing `prev = deals` and `setDeals(prev)` on failure is exact and simple. (Refetching also works but flashes the skeleton; snapshot restore is smoother for a single failed swipe.)
- **401 must win over the generic error branch.** Check `err instanceof AuthError` *first* in every catch; otherwise an expired session shows "Could not load deals" and a Retry that will also 401 forever. The instanceof check requires throwing the **same** `AuthError` class from `lib/api.ts` everywhere — don't redefine it per-file.
- **Don't loop.** If [PLAN-feed-freshness](PLAN-feed-freshness.md)'s "one re-fetch when `refreshing`" is present, guard it so a persistently-500ing `/api/deals` doesn't retrigger endlessly. A `useRef` "already re-fetched once this mount" flag, or only scheduling the re-fetch inside the *success* path, prevents a hot retry loop.
- **`res.json()` can throw on a non-JSON error page.** A 500 from the platform (not the route) may return HTML; the helper's inner `try/catch` around `res.json()` handles it so you surface "Request failed (500)" instead of an unhandled `SyntaxError`.
- **`refresh` vs `fetchDeals` differ in loading UI.** `refresh` is called mid-scroll by pull-to-refresh; do **not** set the full-screen `loading` skeleton there or the list will collapse to skeletons on every pull. Only `fetchDeals` (initial/tab/period change) drives the skeleton.
- **Sign-out race.** `router.push('/auth')` on 401 is enough; do not also call `supabase.auth.signOut()` in the fetch path — the session is already invalid and an extra network call can itself 401 and re-enter the handler.
- **Keep the changes client-only.** No API routes change here. If a route *needs* to change to return a better error, that belongs in the relevant server plan, not this one.

## Acceptance criteria

1. **Expired session → auth, not empty feed.** Simulate 401: in dev tools, set an Overrides/blocklist or temporarily edit `/api/deals` to `return NextResponse.json({error:'Unauthorized'},{status:401})`. Loading the feed now redirects to `/auth` (not "All caught up"). Revert the temporary edit.
2. **Server error → error state with Retry.** Temporarily make `/api/deals` return `status: 500`. The feed shows an error message + Retry (not "All caught up"); Retry re-requests. Revert.
3. **Failed dismiss rolls back.** With the network throttled to offline, swipe-dismiss a card → it animates out, then reappears (state restored) and an error message shows. Online, dismiss works and the card stays gone after refresh.
4. **Failed save shows no false success.** Offline, swipe-save → **no** green flash; an error message shows. Online, the green flash appears only after the 200.
5. **Pull-to-refresh spinner always resets.** Offline, pull to refresh → spinner appears and then stops (does not spin forever); an error is surfaced.
6. Happy path unchanged: online, all tabs load, dismiss/save/unsave and pull-to-refresh behave exactly as before. `npm run build` passes.

## Out of scope

- The server-side causes of those errors (atomic scrape, RLS, bounded query) → [PLAN-feed-freshness](PLAN-feed-freshness.md), [PLAN-supabase-security](PLAN-supabase-security.md), [PLAN-dismissed-hardening](PLAN-dismissed-hardening.md).
- A global toast system — a simple inline `error` string per feed is enough here; introducing a toast library is a separate decision.
