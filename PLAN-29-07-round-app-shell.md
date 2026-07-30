# PLAN: Stop tearing down the whole app on every tab switch

**Rank: 2 of 5.**

## Goal

Every tap on the bottom tab bar currently **unmounts and rebuilds the entire app**: the header, the
tutorial, the nav bar itself, and the feed. The visible symptoms are a nav bar that fades out and
back in *under the thumb that just tapped it*, a full-screen skeleton flash, and a lost scroll
position — on every single navigation, which for this app is the most common interaction there is.

### Root cause

All three tabs are separate route segments that each render the same component:

- [app/page.tsx](app/page.tsx) → `<HomePage />`
- [app/trending/page.tsx](app/trending/page.tsx) → `<HomePage />`
- [app/saved/page.tsx](app/saved/page.tsx) → `<HomePage />`

`HomePage` decides which feed to show from `usePathname()`
([components/HomePage.tsx:47-50](components/HomePage.tsx)). But because `/`, `/trending` and
`/saved` are **sibling route segments**, React has no shared parent below `app/layout.tsx` that
holds `HomePage`. Navigating swaps the page subtree, so `HomePage` unmounts and a fresh one mounts.
The build output confirms they are three independent entries:

```
○ /
○ /saved
○ /trending
```

Three consequences, in descending order of how bad they look:

1. **The nav bar fades out on every tab switch.** [HomePage.tsx:25-45](components/HomePage.tsx) has
   `const [navReady, setNavReady] = useState(false)` plus a mount effect that polls
   `window.innerHeight` until it stabilises (2 stable ticks at 60 ms, hard fallback at 800 ms).
   Until then the nav is `opacity-0 pointer-events-none`. That workaround is correct for the *iOS
   cold-launch* case it was written for (commit `80c4491`), but because `HomePage` remounts on every
   navigation, `navReady` resets to `false` **every time** — so the bar you just tapped vanishes for
   120–800 ms and cannot be tapped again during that window.
2. **A full skeleton flash and a refetch on every switch.** `DealFeed` remounts with empty state, so
   [DealFeed.tsx:129-139](components/DealFeed.tsx) renders four skeleton cards, then re-requests
   `/api/deals` for data it may have fetched seconds ago. Hot → Saved → Hot is three full round
   trips.
3. **Session state is destroyed.** `dismissedIds` ([DealFeed.tsx:40](components/DealFeed.tsx)) — the
   ref that stops a just-dismissed deal flashing back on the other feed — is wiped on every
   navigation. That is the exact bug commit `a9cec2c` added it to fix; it only works today because
   the write usually commits before you switch tabs.

### After this plan

- The header, tab bar and tutorial live in a layout that **persists across all three tabs**. The nav
  never fades after the first launch.
- The viewport-settling workaround runs **once per app session**, which is what it was always meant
  to do.
- Switching back to a tab paints its cached deals instantly, then revalidates in the background.
- `dismissedIds` survives tab switches.

## Exact files to touch

| File | Change |
|------|--------|
| `app/(app)/layout.tsx` | **New.** Renders the persistent shell around `{children}` |
| `components/AppShell.tsx` | **New.** Client shell: header, overflow menu, tutorial, bottom nav, blocked-merchants modal, reset-feed context |
| `app/page.tsx` | **Move** to `app/(app)/page.tsx`; body becomes `<DealFeed tab="hot" />` |
| `app/trending/page.tsx` | **Move** to `app/(app)/trending/page.tsx`; body becomes `<DealFeed tab="trending" />` |
| `app/saved/page.tsx` | **Move** to `app/(app)/saved/page.tsx`; body becomes `<SavedFeed />` |
| [components/HomePage.tsx](components/HomePage.tsx) | **Delete** — fully replaced by `AppShell` |
| [components/DealFeed.tsx](components/DealFeed.tsx) | Consume the reset context; add a module-level cache for instant repaint |
| [components/SavedFeed.tsx](components/SavedFeed.tsx) | Consume the reset context (so "Reset dismissed" doesn't need to remount it) |

`app/auth/` stays exactly where it is — it must **not** be inside the route group, or the signed-out
page would render the tab bar.

> **Route groups do not change URLs.** `app/(app)/page.tsx` still serves `/`. The parenthesised
> segment exists purely to give the three tabs a shared layout. The proxy matcher in
> [proxy.ts:46-48](proxy.ts) is unaffected and needs no edit.

## Implementation order

### Step 1 — create the route group and move the pages

Do this as **moves**, not copies. If `app/page.tsx` and `app/(app)/page.tsx` both exist, they both
resolve to `/` and the build fails with a duplicate-route error.

```bash
mkdir -p "app/(app)/trending" "app/(app)/saved"
git mv app/page.tsx "app/(app)/page.tsx"
git mv app/trending/page.tsx "app/(app)/trending/page.tsx"
git mv app/saved/page.tsx "app/(app)/saved/page.tsx"
rmdir app/trending app/saved
```

Leave `app/layout.tsx`, `app/globals.css`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/favicon.ico`
and `app/auth/` at the `app/` root.

### Step 2 — `components/AppShell.tsx` (new)

Lift everything from [HomePage.tsx](components/HomePage.tsx) **except** the feed switch. Start from
the existing file and make these changes:

- Take `{ children }: { children: React.ReactNode }` and render it where the feed switch was
  (inside the existing `<div className="pb-20">`).
- Delete the `activeTab` derivation's `saved`/`hot`/`trending` *feed rendering*; keep the
  `usePathname()`-based `activeTab` — the nav still needs it for the active-tab highlight.
- Delete `feedKey` / `setFeedKey`. Replace with a reset token exposed through context (Step 3).
- Keep the `navReady` effect **verbatim**, but guard it with a module-level flag so it only ever
  runs on a true cold launch:

```ts
// Module scope, above the component. The iOS viewport only settles once per app
// launch; without this the effect re-hides the nav on every client navigation.
let viewportSettled = false

// ...inside the component:
const [navReady, setNavReady] = useState(viewportSettled)
useEffect(() => {
  if (viewportSettled) return
  let lastHeight = window.innerHeight
  let stableTicks = 0
  const interval = setInterval(() => {
    if (window.innerHeight === lastHeight) {
      if (++stableTicks >= 2) finish()
    } else {
      lastHeight = window.innerHeight
      stableTicks = 0
    }
  }, 60)
  const fallback = setTimeout(finish, 800)
  function finish() {
    clearInterval(interval)
    clearTimeout(fallback)
    viewportSettled = true
    setNavReady(true)
  }
  return () => { clearInterval(interval); clearTimeout(fallback) }
}, [])
```

> With the layout persisting, this effect would already run only once — the module flag is belt and
> braces for a full page reload landing directly on `/saved`, and it makes the intent explicit.

Also swap the three nav `<button onClick={() => router.push(...)}>` for `next/link`:

```tsx
import Link from 'next/link'
// ...
<Link href="/trending" className={...}>…</Link>
```

`<Link>` prefetches the target route on viewport entry, so the transition is instant instead of
waiting on a fresh RSC request. Keep every existing class name; only the element and the
`onClick`→`href` change.

### Step 3 — the reset-dismissed context

"Reset dismissed" currently works by bumping `feedKey` to force a remount
([HomePage.tsx:59-65](components/HomePage.tsx)) — which is exactly the teardown we are removing. It
needs a signal instead.

Create `components/FeedResetContext.tsx`:

```tsx
'use client'
import { createContext, useContext } from 'react'

/** Bumped whenever the user resets dismissed deals or changes blocked retailers. */
export const FeedResetContext = createContext(0)
export const useFeedReset = () => useContext(FeedResetContext)
```

In `AppShell`, hold `const [resetToken, setResetToken] = useState(0)`, wrap `{children}` in
`<FeedResetContext.Provider value={resetToken}>`, and have both `handleResetDismissed` and the
modal's `onChanged` call `setResetToken(t => t + 1)`.

In `DealFeed`, consume it:

```ts
const resetToken = useFeedReset()

useEffect(() => {
  if (resetToken === 0) return   // initial mount — fetchDeals already ran
  dismissedIds.current.clear()
  fetchDeals()
}, [resetToken])                 // eslint-disable-line react-hooks/exhaustive-deps
```

Do the same in `SavedFeed` calling `fetchSaved()` (blocked-retailer changes don't affect saved
deals, but a reset should still resync it and it costs nothing).

Then delete the inline reset button's manual `dismissedIds.current.clear()` at
[DealFeed.tsx:212-221](components/DealFeed.tsx) and route it through the context too, so there is
one code path:

```tsx
onClick={async () => {
  try {
    await fetchJson('/api/reset-dismissed', { method: 'POST' })
  } catch (err) {
    if (err instanceof AuthError) { router.push('/auth'); return }
    setError('Could not reset — try again'); return
  }
  dismissedIds.current.clear()
  fetchDeals()
}}
```

(Note this also fixes a real bug: that button currently uses raw `fetch` with **no** `res.ok` check,
so a 401 silently clears the local state and shows an unchanged empty feed.)

### Step 4 — instant repaint on tab switch

`DealFeed` still remounts when the page segment changes (that is unavoidable without collapsing the
three URLs into one). Give it a module-level cache so the remount is invisible:

```ts
// Module scope. Survives remounts within a session; cleared on a full reload.
// Purely a paint optimisation — every cache hit is revalidated immediately.
const feedCache = new Map<string, DealsResponse>()
```

In the component:

```ts
const cacheKey = `${tab}:${period}`
const cached = feedCache.get(cacheKey)
const [deals, setDeals] = useState<Deal[]>(cached?.deals ?? [])
const [loading, setLoading] = useState(!cached)
const [lastScrapedAt, setLastScrapedAt] = useState<string | null>(cached?.last_scraped_at ?? null)
```

and in `applyResponse`, write through:

```ts
const applyResponse = (data: DealsResponse) => {
  feedCache.set(`${tab}:${period}`, data)
  setDeals((data.deals ?? []).filter(d => !dismissedIds.current.has(String(d.id))))
  setLastScrapedAt(data.last_scraped_at ?? null)
  setRefreshing(Boolean(data.refreshing))
}
```

`fetchDeals` must **not** call `setLoading(true)` when there is a cache hit, or you reintroduce the
skeleton flash:

```ts
const fetchDeals = useCallback(async (p?: 'today' | 'week') => {
  const activePeriod = p ?? period
  if (!feedCache.has(`${tab}:${activePeriod}`)) setLoading(true)
  // ...unchanged from here
```

Also make `dismissedIds` module-level so it too survives the remount:

```ts
// Module scope — deal ids dismissed this session, shared across every feed mount.
const dismissedThisSession = new Set<string>()
```

and replace `dismissedIds.current` with `dismissedThisSession` throughout. Keyed on `deal_id`, which
is shared across tabs, so a deal dismissed on Hot stays hidden on Trending — which is what the
comment at [DealFeed.tsx:36-40](components/DealFeed.tsx) says it is for, and what it currently fails
to do across a navigation.

### Step 5 — `app/(app)/layout.tsx` (new)

```tsx
import AppShell from '@/components/AppShell'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
```

And the three pages become one-liners:

```tsx
// app/(app)/page.tsx
import DealFeed from '@/components/DealFeed'
export default function Page() { return <DealFeed tab="hot" /> }
```
```tsx
// app/(app)/trending/page.tsx
import DealFeed from '@/components/DealFeed'
export default function Page() { return <DealFeed tab="trending" /> }
```
```tsx
// app/(app)/saved/page.tsx
import SavedFeed from '@/components/SavedFeed'
export default function Page() { return <SavedFeed /> }
```

### Step 6 — delete `components/HomePage.tsx`

Confirm nothing imports it: `grep -rn "HomePage" app components` must return nothing.

## Edge cases found while exploring

1. **Duplicate routes.** `app/page.tsx` and `app/(app)/page.tsx` both resolve to `/`. You must
   `git mv`, not copy. The build error is clear but only appears at `npm run build`, not `npm run dev`.
2. **`/auth` must stay outside the group.** [proxy.ts:31-41](proxy.ts) redirects signed-out users to
   `/auth` and signed-in users away from it. If `/auth` inherited `AppShell` it would render a tab
   bar for a user who has no session, and `AppShell` would call
   `createClient().auth.signOut()` against nothing.
3. **`DealFeed` still remounts across tabs** even with the shared layout — a route group gives you a
   shared *layout*, not a shared *page component*. That is why Step 4 exists. Don't skip it and
   assume the layout alone fixes the skeleton flash; it only fixes the chrome.
4. **The module-level `feedCache` is per JS bundle instance, not per user.** That is fine here (a
   single-user app, and the cache is cleared by any full reload), but do not promote it to
   `localStorage` — the deals payload contains nothing sensitive, but it would then survive sign-out.
5. **`AnimatePresence` + `layout` on `DealCard`** ([DealCard.tsx:67-73](components/DealCard.tsx)):
   painting cached deals on mount means Framer sees them as initial children, so no entry animation
   fires. That is the desired behaviour (instant paint), but it will look different from today's
   skeleton-then-populate. Confirm it doesn't jank on device.
6. **`SwipeTutorial` moves into the shell**, so it stops re-evaluating `localStorage` on every
   navigation. It already guards on the storage key, so behaviour is unchanged — but it also stops
   restarting its animation loop on every tab switch, which was leaking a `while (!cancelled)` loop
   per mount.
7. **The `pb-20` spacer and the `env(safe-area-inset-*)` padding must move with the chrome**, not the
   pages — otherwise the last deal card sits under the tab bar on `/saved` only.
8. **`useFeedReset()` returns `0` on first render.** The `resetToken === 0` early return in Step 3 is
   what stops a double-fetch on mount. Don't remove it.

## Acceptance criteria

1. `npm run build` — clean, and the route list still shows exactly `/`, `/saved`, `/trending`,
   `/auth` (route groups must not appear in URLs).
2. `grep -rn "HomePage" app components` — no results.
3. **The nav bar never fades after launch.** Cold-launch the PWA from the iOS home screen: the bar
   fades in once (existing behaviour, still correct). Then tap Hot → Trending → Saved → Hot: the bar
   stays fully opaque and stays tappable throughout. This is the headline fix — verify it on device,
   not just in a desktop browser, because the `navReady` workaround only triggers on a viewport that
   actually resizes.
4. **No skeleton flash on return.** Load Hot, wait for deals, go to Saved, come back to Hot: deals
   are on screen immediately, with no four-card shimmer.
5. **Dismissals survive navigation.** Dismiss a deal on Hot, immediately tap Trending then Hot. The
   dismissed deal does not reappear. (Before this change, it can — `dismissedIds` was wiped.)
6. **Reset dismissed still works** from both entry points (overflow menu, and the button in the
   "All caught up" empty state) and refills the feed without a page reload.
7. **Blocked retailers still works**: add a retailer in the modal, close it, and the feed drops that
   retailer's deals without a manual refresh.
8. Signed out, `/`, `/trending` and `/saved` all still redirect to `/auth`, and `/auth` renders with
   **no** header and **no** tab bar.
