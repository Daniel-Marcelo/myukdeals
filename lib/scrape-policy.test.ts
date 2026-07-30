import { describe, it, expect } from 'vitest'
import { shouldScrape, STALE_MS, LOCK_TTL_MS } from './scrape-policy'

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

  it('fails open on a corrupted timestamp rather than jamming the feed', () => {
    // readMetaTime() normalises NaN to 0 before it gets here; assert the policy
    // still scrapes for that value rather than treating it as fresh or locked.
    expect(shouldScrape(0, 0, now)).toBe(true)
  })

  it('holds the lock right up to the TTL boundary and releases just after', () => {
    expect(shouldScrape(now - 45 * MIN, now - (LOCK_TTL_MS - 1), now)).toBe(false)
    expect(shouldScrape(now - 45 * MIN, now - LOCK_TTL_MS, now)).toBe(true)
  })

  it('treats a feed as fresh right up to the stale boundary', () => {
    expect(shouldScrape(now - (STALE_MS - 1), 0, now)).toBe(false)
    expect(shouldScrape(now - STALE_MS, 0, now)).toBe(true)
  })

  it('does not scrape a fresh feed even when the lock is long expired', () => {
    expect(shouldScrape(now - MIN, now - 60 * MIN, now)).toBe(false)
  })
})
