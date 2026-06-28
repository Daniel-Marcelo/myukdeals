import { NextResponse } from 'next/server'
import { scrapeTabNow, HotPeriod } from '@/lib/scraper'

const VALID_PERIODS: HotPeriod[] = ['today', 'week', 'month']

export async function GET(request: Request) {
  const token = request.headers.get('x-cron-secret')
  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const { searchParams } = new URL(request.url)
  const period = (searchParams.get('period') ?? 'today') as HotPeriod
  if (!VALID_PERIODS.includes(period)) {
    return NextResponse.json({ error: `Invalid period: ${period}` }, { status: 400 })
  }
  try {
    const deals = await scrapeTabNow('hot', period)
    return NextResponse.json({ tab: 'hot', period, count: deals.length, deals })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
