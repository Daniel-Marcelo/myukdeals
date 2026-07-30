/**
 * Pure scrape scheduling policy — no network, no database, no env access.
 *
 * Lives in its own module (rather than in scraper.ts) so tests can import it
 * without pulling in supabase-admin, which imports `server-only` and throws
 * outside a React Server Component context.
 */

/** A feed older than this is due for a re-scrape. */
export const STALE_MS = 30 * 60 * 1000

/**
 * A scrape lock older than this is assumed abandoned — the function that
 * claimed it was killed mid-scrape (Vercel suspending `after()` work, or the
 * route's maxDuration firing) and never released it.
 */
export const LOCK_TTL_MS = 3 * 60 * 1000

/** Per-request timeout for a single HotUKDeals page fetch. */
export const FETCH_TIMEOUT_MS = 12_000

/**
 * Should we scrape this tab/period right now?
 *
 * `lastSuccessMs` is the last scrape that actually COMMITTED, and `lockedAtMs`
 * is when another request claimed the scrape slot. These are deliberately two
 * separate values: claiming the slot must never make the feed look fresh, or
 * the UI ends up reporting "Updated just now" over stale deals.
 *
 * Both inputs fail open (0 = "very old"), so a missing or corrupted timestamp
 * results in a scrape rather than a permanently jammed feed.
 */
export function shouldScrape(
  lastSuccessMs: number,
  lockedAtMs: number,
  nowMs: number,
  staleMs: number = STALE_MS,
  lockTtlMs: number = LOCK_TTL_MS,
): boolean {
  if (nowMs - lastSuccessMs < staleMs) return false
  if (nowMs - lockedAtMs < lockTtlMs) return false
  return true
}
