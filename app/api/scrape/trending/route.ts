import { NextResponse } from 'next/server'
import { scrapeTabNow } from '@/lib/scraper'

export async function GET(request: Request) {
  const token = request.headers.get('x-cron-secret')
  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const deals = await scrapeTabNow('trending')
    return NextResponse.json({ tab: 'trending', count: deals.length, deals })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
