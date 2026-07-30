import { supabaseAdmin } from './supabase-admin'
import { parseThreadsFromHtml, type Deal, type HotPeriod } from './parse-deals'
import { shouldScrape, FETCH_TIMEOUT_MS } from './scrape-policy'

// Re-export so existing importers keep resolving these from '@/lib/scraper'.
export type { Deal, HotPeriod }
export { shouldScrape, STALE_MS } from './scrape-policy'

const TAB_URLS: Record<'hot' | 'trending', string> = {
  hot: 'https://www.hotukdeals.com/hottest',
  trending: 'https://www.hotukdeals.com/hot',
}

const PERIOD_COOKIE: Record<HotPeriod, string> = {
  today: '%7B%22homepage%22%3A%22hottest%22%2C%22threadTypeId-1%22%3A%22hot%22%2C%22hottest-widget-time%22%3A%22day%22%7D',
  week:  '%7B%22homepage%22%3A%22hottest%22%2C%22threadTypeId-1%22%3A%22hot%22%2C%22hottest-widget-time%22%3A%22week%22%7D',
  month: '%7B%22homepage%22%3A%22hottest%22%2C%22threadTypeId-1%22%3A%22hot%22%2C%22hottest-widget-time%22%3A%22month%22%7D',
}

const PAGES_TO_SCRAPE = 3

/**
 * Fetch one HotUKDeals page, retrying once on failure.
 *
 * The timeout is not optional: without it a hung connection blocks until the
 * platform kills the whole function, which strands the scrape lock and leaves
 * the feed frozen until the lock TTL expires.
 */
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

async function scrapePage(tab: 'hot' | 'trending', page: number, indexOffset: number, period: HotPeriod): Promise<Deal[]> {
  const baseUrl = TAB_URLS[tab]
  const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`
  const cookie = tab === 'hot' ? `navi=${PERIOD_COOKIE[period]}` : ''

  const html = await fetchPage(url, cookie)
  return parseThreadsFromHtml(html, tab, period, indexOffset)
}

async function scrapeTab(tab: 'hot' | 'trending', period: HotPeriod = 'today'): Promise<Deal[]> {
  const allDeals: Deal[] = []
  for (let page = 1; page <= PAGES_TO_SCRAPE; page++) {
    const deals = await scrapePage(tab, page, allDeals.length, period)
    if (deals.length === 0) break
    allDeals.push(...deals)
  }
  return allDeals
}

export async function scrapeTabNow(tab: 'hot' | 'trending', period: HotPeriod = 'today'): Promise<Deal[]> {
  const deals = await scrapeTab(tab, period)

  if (deals.length === 0) throw new Error(`No deals scraped for tab: ${tab}`)

  // Soft sanity check: warn (do NOT block) when a scrape looks degraded, so a
  // partial HUKD markup change surfaces in logs instead of silently shipping
  // half-empty cards. Thresholds are deliberately loose.
  const priced = deals.filter((d) => d.price).length
  const withMerchant = deals.filter((d) => d.merchant).length
  if (deals.length < 15 || priced / deals.length < 0.3 || withMerchant / deals.length < 0.3) {
    console.warn(
      `[scrape] degraded result for ${tab}/${period}: ${deals.length} deals, ` +
      `${priced} priced, ${withMerchant} with merchant — HUKD markup may have changed`
    )
  }

  // Atomic replace: a single Postgres transaction deletes the old tab/period rows
  // and inserts the new ones. If the insert fails, the delete rolls back too, so
  // the feed is never left empty. See supabase/migrations/replace_deals_fn.sql.
  const { error } = await supabaseAdmin.rpc('replace_deals', {
    p_tab: tab,
    p_period: period,
    p_deals: deals,
  })
  if (error) throw new Error(`replace_deals failed for ${tab}/${period}: ${error.message}`)

  await recordScrape(tab, period)
  return deals
}

async function recordScrape(tab: 'hot' | 'trending', period: HotPeriod): Promise<void> {
  await supabaseAdmin.from('meta').upsert(
    { key: `last_scraped:${tab}:${period}`, value: new Date().toISOString() },
    { onConflict: 'key' }
  )
}

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

/** Latest successful scrape time (ISO) for a tab/period, or null if never scraped. */
export async function getLastScraped(tab: 'hot' | 'trending', period: HotPeriod): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('meta')
    .select('value')
    .eq('key', `last_scraped:${tab}:${period}`)
    .maybeSingle()
  return data?.value ?? null
}

/**
 * Self-heal: if the tab/period hasn't been scraped in STALE_MS, scrape it now.
 * Returns true if a scrape ran AND committed.
 *
 * Concurrency is handled by a SEPARATE `scrape_lock:*` key, never by the
 * user-facing `last_scraped:*` key. Claiming the lock must not make the feed
 * claim to be fresh — `last_scraped` is written only by recordScrape(), after
 * replace_deals() has committed — otherwise the UI reports "Updated just now"
 * over deals that are still 45 minutes old.
 */
export async function scrapeIfStale(tab: 'hot' | 'trending', period: HotPeriod): Promise<boolean> {
  const freshKey = `last_scraped:${tab}:${period}`
  const lockKey = `scrape_lock:${tab}:${period}`

  const [lastSuccess, lockedAt] = await Promise.all([
    readMetaTime(freshKey),
    readMetaTime(lockKey),
  ])
  if (!shouldScrape(lastSuccess, lockedAt, Date.now())) return false

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

export async function scrapeNow(): Promise<{ hot: number; trending: number }> {
  const [hotResult, trendingResult] = await Promise.allSettled([
    scrapeTabNow('hot'),
    scrapeTabNow('trending'),
  ])
  if (hotResult.status === 'rejected') console.error('Hot scrape failed:', hotResult.reason)
  if (trendingResult.status === 'rejected') console.error('Trending scrape failed:', trendingResult.reason)
  return {
    hot: hotResult.status === 'fulfilled' ? hotResult.value.length : 0,
    trending: trendingResult.status === 'fulfilled' ? trendingResult.value.length : 0,
  }
}
