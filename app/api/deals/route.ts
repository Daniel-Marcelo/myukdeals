import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'
import { scrapeIfStale, getLastScraped } from '@/lib/scraper'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STALE_MS = 30 * 60 * 1000

export async function GET(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') === 'trending' ? 'trending' : 'hot'
  const period = searchParams.get('period') === 'week' ? 'week' : 'today'
  // Trending is only ever scraped/stored under period 'today'.
  const effectivePeriod = tab === 'hot' ? period : 'today'

  // Freshness + prefs — neither depends on which deals come back.
  const [lastScraped, { data: prefs }] = await Promise.all([
    getLastScraped(tab, effectivePeriod),
    client.from('user_preferences').select('blocked_merchants').eq('user_id', user.id).maybeSingle(),
  ])

  const isStale = !lastScraped || Date.now() - Date.parse(lastScraped) > STALE_MS
  if (isStale) {
    // Self-heal after the response is sent. scrapeIfStale re-checks staleness and
    // claims the slot, so racing requests won't double-scrape. Errors must be
    // caught here or they surface as detached function crashes in Vercel logs.
    after(async () => {
      try {
        await scrapeIfStale(tab, effectivePeriod)
      } catch (err) {
        console.error('background scrape failed:', err)
      }
    })
  }

  const blockedMerchants = prefs?.blocked_merchants ?? []

  // Candidate deals for this tab/period (bounded to 150). Read with the anon
  // client (deals are public data; a public SELECT policy allows this).
  const { data: rawDeals, error } = await supabase
    .from('deals')
    .select('*')
    .eq('tab', tab)
    .eq('period', effectivePeriod)
    .order(tab === 'trending' ? 'order_index' : 'temperature', { ascending: tab === 'trending' })
    .limit(150)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const candidates = rawDeals ?? []
  const ids = candidates.map((d) => d.id)

  // Only look up dismissed rows among the current candidates — a bounded query,
  // so it can't blow the URL length no matter how large `dismissed` grows.
  let dismissedIds: string[] = []
  if (ids.length > 0) {
    const { data: dismissedRows } = await client
      .from('dismissed')
      .select('deal_id')
      .in('deal_id', ids)
    dismissedIds = dismissedRows?.map((r) => r.deal_id) ?? []
  }
  const dismissedSet = new Set(dismissedIds.map(String))

  const deals = candidates.filter((d) => {
    if (dismissedSet.has(String(d.id))) return false
    if (
      blockedMerchants.length > 0 &&
      d.merchant &&
      blockedMerchants.includes(d.merchant.toLowerCase().trim())
    ) {
      return false
    }
    return true
  })

  return NextResponse.json(
    { deals, last_scraped_at: lastScraped, refreshing: isStale },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
