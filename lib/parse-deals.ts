import * as cheerio from 'cheerio'

export type HotPeriod = 'today' | 'week' | 'month'

export type Deal = {
  id: string
  title: string
  description: string | null
  price: string | null
  merchant: string | null
  temperature: number
  comment_count: number
  image_url: string | null
  deal_url: string
  merchant_url: string | null
  tab: 'hot' | 'trending'
  period: HotPeriod
  order_index: number
  posted_at: string | null
  trending_for: string | null
}

// Compact "time since it reached 100°" label for the trending tab, derived from
// thread.hotDate (unix seconds). Kept short to fit the chip: "just now" / "5m" / "3h" / "2d".
function trendingLabel(hotDateUnixSec: number, nowMs: number = Date.now()): string {
  const mins = Math.floor((nowMs - hotDateUnixSec * 1000) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/**
 * Pure parser: HotUKDeals page HTML -> Deal[] for a single page.
 * No network, no database, no env access — safe to import in tests.
 *
 * Each deal card is a Vue3 component whose data lives in a JSON blob on the
 * `data-vue3` attribute (`parsed.props.thread`). Cheerio decodes the HTML
 * entities when we read the attribute.
 */
export function parseThreadsFromHtml(
  html: string,
  tab: 'hot' | 'trending',
  period: HotPeriod,
  indexOffset = 0,
): Deal[] {
  const $ = cheerio.load(html)
  const deals: Deal[] = []

  $('article[id^="thread_"]').each((index, el) => {
    const $el = $(el)
    const id = $el.attr('id')?.replace('thread_', '')
    if (!id) return

    const vue3Raw = $el.find('[data-vue3]').first().attr('data-vue3')
    if (!vue3Raw) return

    let thread: Record<string, unknown> & {
      title?: string
      temperature?: number
      merchant?: { merchantName?: string; merchantUrlName?: string }
      publishedAt?: number
      shareableLink?: string
      price?: number | string
      mainImage?: { path?: string; name?: string }
      description?: string
      commentCount?: number
      hotDate?: number
    }
    try {
      const parsed = JSON.parse(vue3Raw)
      thread = parsed?.props?.thread ?? {}
    } catch {
      return
    }

    const title = thread.title ?? null
    if (!title) return

    const temperature = Math.round(thread.temperature ?? 0)
    const merchant = thread.merchant?.merchantName ?? null
    const posted_at = thread.publishedAt
      ? new Date(thread.publishedAt * 1000).toISOString()
      : null
    const deal_url = thread.shareableLink ?? `https://www.hotukdeals.com/deals/${id}`
    const merchant_url = thread.merchant?.merchantUrlName
      ? `https://${thread.merchant.merchantUrlName}`
      : null

    const price = thread.price != null ? `£${thread.price}` : null
    const image_url = thread.mainImage
      ? `https://images.hotukdeals.com/${thread.mainImage.path}/${thread.mainImage.name}/re/202x202/qt/70/${thread.mainImage.name}.jpg`
      : null
    const description = thread.description ?? null
    const comment_count = thread.commentCount ?? 0

    // trending_for used to be scraped from a `.chip--type-default .size--all-s`
    // element, but that chip is hydrated client-side by Vue and is absent from
    // the server HTML (0 hits). Derive it from thread.hotDate instead — the
    // moment the deal crossed 100°, which is exactly what the trending tab sorts by.
    const trending_for = tab === 'trending' && typeof thread.hotDate === 'number'
      ? trendingLabel(thread.hotDate)
      : null

    deals.push({
      id,
      title,
      description,
      price,
      merchant,
      temperature,
      comment_count,
      image_url,
      deal_url,
      merchant_url,
      tab,
      period,
      order_index: indexOffset + index,
      posted_at,
      trending_for,
    })
  })

  return deals
}
