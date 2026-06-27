import * as cheerio from 'cheerio'
import { supabase } from './supabase'

const STALE_MINUTES = 30

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
  order_index: number
  posted_at: string | null
}

const TAB_URLS: Record<'hot' | 'trending', string> = {
  hot: 'https://www.hotukdeals.com/hottest',
  trending: 'https://www.hotukdeals.com/hot',
}

const PAGES_TO_SCRAPE = 3

async function scrapePage(tab: 'hot' | 'trending', page: number, indexOffset: number): Promise<Deal[]> {
  const baseUrl = TAB_URLS[tab]
  const url = page === 1 ? baseUrl : `${baseUrl}?page=${page}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'Referer': 'https://www.hotukdeals.com/',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)

  const html = await res.text()
  const $ = cheerio.load(html)
  const deals: Deal[] = []

  $('article[id^="thread_"]').each((index, el) => {
    const $el = $(el)
    const id = $el.attr('id')?.replace('thread_', '')
    if (!id) return

    // Data is embedded as JSON in the data-vue3 attribute
    const vue3Raw = $el.find('[data-vue3]').first().attr('data-vue3')
    if (!vue3Raw) return

    let thread: Record<string, any>
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
      order_index: indexOffset + index,
      posted_at,
    })
  })

  return deals
}

async function scrapeTab(tab: 'hot' | 'trending'): Promise<Deal[]> {
  const allDeals: Deal[] = []
  for (let page = 1; page <= PAGES_TO_SCRAPE; page++) {
    const deals = await scrapePage(tab, page, allDeals.length)
    if (deals.length === 0) break
    allDeals.push(...deals)
  }
  return allDeals
}

export async function scrapeNow(): Promise<{ hot: number; trending: number }> {
  const [hotResult, trendingResult] = await Promise.allSettled([scrapeTab('hot'), scrapeTab('trending')])
  const hotDeals = hotResult.status === 'fulfilled' ? hotResult.value : []
  const trendingDeals = trendingResult.status === 'fulfilled' ? trendingResult.value : []
  if (hotResult.status === 'rejected') console.error('Hot scrape failed:', hotResult.reason)
  if (trendingResult.status === 'rejected') console.error('Popular scrape failed:', trendingResult.reason)

  const seen = new Set<string>()
  const allDeals = [...hotDeals, ...trendingDeals].filter(d => {
    if (seen.has(d.id)) return false
    seen.add(d.id)
    return true
  })

  if (hotDeals.length > 0) await supabase.from('deals').delete().eq('tab', 'hot')
  if (trendingDeals.length > 0) await supabase.from('deals').delete().eq('tab', 'trending')

  if (allDeals.length > 0) {
    await supabase.from('deals').insert(allDeals)
  }

  await supabase
    .from('meta')
    .update({ value: new Date().toISOString() })
    .eq('key', 'last_scraped_at')

  return { hot: hotDeals.length, trending: trendingDeals.length }
}

export async function scrapeIfStale(): Promise<void> {
  const { data: meta } = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'last_scraped_at')
    .single()

  const lastScraped = meta?.value ? new Date(meta.value) : new Date(0)
  const minutesSince = (Date.now() - lastScraped.getTime()) / 1000 / 60

  if (minutesSince < STALE_MINUTES) return

  await scrapeNow()
}
