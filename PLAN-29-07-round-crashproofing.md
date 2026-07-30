# PLAN: Crash-proofing and CI teeth — an error boundary, and a lint gate that actually runs

**Rank: 5 of 5.**

## Goal

Two gaps that don't hurt today but remove your safety net when something else does.

### Gap 1 — there is no error boundary anywhere

`app/` contains no `error.tsx`, no `global-error.tsx` and no `not-found.tsx`. Every feed component
is a client component doing optimistic updates on data scraped from a third party, so a render
crash is entirely reachable — e.g. a `deal_data` JSON blob in `saved` that predates a shape change,
or `deal.temperature` arriving as `null` and `{deal.temperature}°` rendering fine but a future
`.toFixed()` throwing.

Without a boundary, a throw during render unmounts the whole React tree and the user gets the stock
Next.js error page. In a **standalone PWA there is no browser chrome**, so there is no address bar
and no reload button — the app is a dead grey screen until the user force-quits it from the app
switcher. That is the specific failure mode worth preventing, and `app/error.tsx` gives you a
styled screen with a "Try again" button for about 30 lines of code.

### Gap 2 — CI cannot catch lint regressions, and there are already 7

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs `npm test` and `npm run build`. It does
**not** run `npm run lint`. Next 16 does not run ESLint during `next build` either, so nothing in
the pipeline reads the ESLint config at all. `npx eslint .` currently reports:

```
components/BlockedMerchantsModal.tsx  64:84  react/no-unescaped-entities
components/DealCard.tsx               60:29  @typescript-eslint/no-explicit-any
components/SavedFeed.tsx              35:29  @typescript-eslint/no-explicit-any
components/SwipeTutorial.tsx          42:23  react/no-unescaped-entities
components/SwipeTutorial.tsx         108:7   react-hooks/set-state-in-effect
✖ 5 errors
```

> Down from 7: the two `DealFeed`/`SavedFeed` fetch-on-mount errors were resolved while executing
> [PLAN-29-07-round-app-shell.md](PLAN-29-07-round-app-shell.md). `BlockedMerchantsModal.tsx:64`
> disappears when [PLAN-29-07-round-blocked-retailers.md](PLAN-29-07-round-blocked-retailers.md)
> lands, leaving 4 for this plan.

Adding the gate before fixing these would fail CI immediately, so the order below matters.

### After this plan

- A render crash shows a recoverable, on-brand screen instead of bricking the PWA.
- `npx eslint .` exits 0, and CI fails if that ever stops being true.

## Exact files to touch

| File | Change |
|------|--------|
| `app/error.tsx` | **New.** Route-level boundary for the app tree |
| `app/global-error.tsx` | **New.** Last-resort boundary (replaces the root layout) |
| `app/not-found.tsx` | **New.** On-brand 404 |
| [components/DealCard.tsx](components/DealCard.tsx) | Type the drag handler properly |
| [components/SavedFeed.tsx](components/SavedFeed.tsx) | Same, plus the effect rule |
| [components/DealFeed.tsx](components/DealFeed.tsx) | Effect rule |
| [components/SwipeTutorial.tsx](components/SwipeTutorial.tsx) | Escape the `"`, plus the effect rule |
| [components/BlockedMerchantsModal.tsx](components/BlockedMerchantsModal.tsx) | Escape the `'` — **already done** if [PLAN-29-07-round-blocked-retailers.md](PLAN-29-07-round-blocked-retailers.md) has landed |
| [package.json](package.json) | `lint` script already exists (`eslint`); no change needed |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | Add the lint step |

## Implementation order

Fix the errors **first**, add the CI gate **last**. Otherwise the first push after this plan fails.

### Step 1 — `app/error.tsx` (new)

```tsx
'use client'

import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Render error:', error)
  }, [error])

  return (
    <main className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center px-6">
      <AlertCircle className="w-8 h-8 text-red-400/80" />
      <p className="text-base font-semibold text-[#ededef] mt-3">Something went wrong</p>
      <p className="text-sm text-[#8a8f98] mt-1 text-center max-w-xs">
        The app hit an unexpected error. Try again — your saved deals are safe.
      </p>
      <button
        onClick={reset}
        className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Try again
      </button>
      {error.digest && (
        <p className="text-[11px] text-[#8a8f98]/40 mt-6 font-mono">{error.digest}</p>
      )}
    </main>
  )
}
```

This deliberately reuses the exact markup vocabulary of the existing error states in
[DealFeed.tsx:190-201](components/DealFeed.tsx) — same icon, same sizes, same indigo pill — so it
does not look like a different app.

### Step 2 — `app/global-error.tsx` (new)

`error.tsx` cannot catch an error thrown by the root layout itself. `global-error.tsx` can, but it
**replaces** the root layout, so it must render its own `<html>` and `<body>`:

```tsx
'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ background: '#0a0a0f', color: '#ededef', margin: 0, minHeight: '100dvh',
                     display: 'flex', flexDirection: 'column', alignItems: 'center',
                     justifyContent: 'center', fontFamily: 'system-ui, sans-serif', padding: '0 1.5rem' }}>
        <p style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong</p>
        <p style={{ fontSize: 14, color: '#8a8f98', marginTop: 4, textAlign: 'center' }}>
          Reload the app to continue.
        </p>
        <button
          onClick={reset}
          style={{ marginTop: 24, background: '#4f46e5', color: '#fff', border: 0,
                   borderRadius: 999, padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  )
}
```

> Inline styles, not Tailwind classes, and no `next/font`. If the root layout is what crashed, the
> font variable and the stylesheet link may not be on the page. Every other approach here produces
> unstyled white text on white.

### Step 3 — `app/not-found.tsx` (new)

```tsx
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center px-6">
      <p className="text-base font-semibold text-[#ededef]">Page not found</p>
      <Link
        href="/"
        className="mt-6 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors"
      >
        Back to deals
      </Link>
    </main>
  )
}
```

### Step 4 — the two `no-explicit-any` errors

[DealCard.tsx:60](components/DealCard.tsx) and [SavedFeed.tsx:34](components/SavedFeed.tsx) both have:
```ts
const handleDragEnd = (_: any, info: { offset: { x: number } }) => {
```

Framer Motion exports the real types. Replace with:
```ts
import type { PanInfo } from 'framer-motion'
// ...
const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
```

`PanInfo` already has `offset: { x: number; y: number }`, so the bodies need no change.

> Check the export first: `grep -rn "PanInfo" node_modules/framer-motion/dist/index.d.ts | head`.
> If v12 has renamed it, use `Parameters<NonNullable<ComponentProps<typeof motion.div>['onDragEnd']>>`
> rather than reintroducing `any`.

### Step 5 — the three `set-state-in-effect` errors

These are **not** all the same bug, and only one has a real fix.

**`SwipeTutorial.tsx:108`** — genuinely fixable. Reading `localStorage` during render breaks SSR, so
the effect exists to defer it to the client. The rule-compliant way to read an external store is
`useSyncExternalStore`:

```ts
const seen = useSyncExternalStore(
  () => () => {},                                     // never changes after mount
  () => localStorage.getItem(STORAGE_KEY) !== null,   // client snapshot
  () => true,                                         // server snapshot: assume seen, so nothing flashes
)
const [dismissed, setDismissed] = useState(false)
const visible = !seen && !dismissed
```
and `dismiss()` becomes `localStorage.setItem(STORAGE_KEY, '1'); setDismissed(true)`. Delete the
`visible` state and its effect entirely. The server snapshot returning `true` is what stops the
tutorial flashing on every hydration for users who have already dismissed it.

**`DealFeed.tsx:81` and `SavedFeed.tsx:165`** — fetch-on-mount. There is no restructure that removes
the setState; the data genuinely arrives asynchronously after mount and this is the documented
pattern for a client component that owns its own fetching. Suppress with a reason rather than
contorting the code.

> **This rule reports on the *call* line inside the effect body, not on the `useEffect` line.** An
> `eslint-disable-next-line` placed above `useEffect(` does nothing — verified. It must go
> immediately above the call:

```ts
useEffect(() => {
  // Fetch-on-mount: the feed owns its own data loading, so the state update is
  // the point, not an accident. The rule targets cascading synchronous renders;
  // this setState lands in an async continuation after the request resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  fetchDeals()
}, [fetchDeals])
```

**Already done** for both feeds' mount effects and both reset effects as part of
[PLAN-29-07-round-app-shell.md](PLAN-29-07-round-app-shell.md). Only `SwipeTutorial.tsx:108`
remains.

> Do **not** silence this by deleting the rule from `eslint.config.mjs`. It is catching a real class
> of bug; you want it on for the next effect somebody writes.

### Step 6 — the two `no-unescaped-entities` errors

[SwipeTutorial.tsx:42](components/SwipeTutorial.tsx):
```tsx
Samsung 65&quot; QLED 4K TV
```
[BlockedMerchantsModal.tsx:64](components/BlockedMerchantsModal.tsx) — already covered by
[PLAN-29-07-round-blocked-retailers.md](PLAN-29-07-round-blocked-retailers.md) Step 5(d). If that
plan has not landed:
```tsx
Deals from these retailers won&apos;t appear in your feed.
```

### Step 7 — the CI gate (do this last)

Verify `npx eslint .` exits 0 before touching the workflow. Then in
[.github/workflows/ci.yml](.github/workflows/ci.yml), insert between `npm ci` and `npm test`:

```yaml
      - run: npm run lint
```

The `lint` script already exists in [package.json](package.json) (`"lint": "eslint"`). No package
change is needed.

## Edge cases found while exploring

1. **`error.tsx` only catches errors below it in the tree.** It cannot catch an error in
   `app/layout.tsx`, which is why Step 2 exists. If
   [PLAN-29-07-round-app-shell.md](PLAN-29-07-round-app-shell.md) has landed, consider a second
   `app/(app)/error.tsx` so a feed crash keeps the header and tab bar on screen and only the feed
   area is replaced — much better UX than losing the whole shell.
2. **`error.tsx` must be a client component.** The `'use client'` directive is mandatory; it receives
   a function prop (`reset`), which server components cannot take.
3. **`global-error.tsx` is only active in production.** In dev, Next shows its own error overlay
   instead. Test it with `npm run build && npm start`, not `npm run dev` — otherwise you will
   conclude it doesn't work.
4. **`reset()` re-renders the segment; it does not reload the page.** If the error is deterministic
   (bad data in the response), "Try again" will fail again immediately. That is acceptable and
   standard — but it is why `error.digest` is surfaced in the UI, so a repeat failure can be matched
   to a Vercel log line.
5. **`not-found.tsx` will rarely be reached** because [proxy.ts:47](proxy.ts) redirects every
   non-API, non-static path to `/auth` for signed-out users, and signed-in users hitting an unknown
   path fall through to it. Add it anyway — it is three lines and the alternative is the unstyled
   default.
6. **Adding lint to CI will also gate the *other* plans in this round.** Run `npx eslint .` after
   each of them, not just at the end.
7. **`vitest.config.ts` only includes `lib/**/*.test.ts`**, so component tests would not run even if
   written. If you ever add them, widen `include` and set `environment: 'jsdom'` (which needs
   `jsdom` as a devDependency). Out of scope here — noted so the next person doesn't waste an hour
   wondering why their `components/` test is silently skipped.

## Acceptance criteria

1. `npx eslint .` — exits 0, no output.
2. `npm test` — still 6+ passing, nothing broken by the `SwipeTutorial` rewrite.
3. `npm run build` — clean, and the route list gains `/_not-found` (it is already there) with no new
   warnings.
4. **The boundary catches a real crash.** Temporarily add `throw new Error('boom')` at the top of
   `DealFeed`'s render, run `npm run build && npm start`, and load `/`. You get the styled
   "Something went wrong" screen with a working "Try again" button — **not** the stock Next error
   page and not a blank screen. Remove the throw.
5. **The global boundary works.** Temporarily throw from `app/layout.tsx`, rebuild, load: you get the
   inline-styled fallback rather than a white screen. Remove the throw.
6. **The tutorial still behaves.** Clear `localStorage` and load the app → the tutorial appears.
   Dismiss it, reload → it does not appear, and it does not flash on screen during hydration.
7. **CI fails on a lint error.** Push a branch with a deliberate `const x: any = 1` in a component
   and confirm the workflow goes red at the lint step, then remove it.
