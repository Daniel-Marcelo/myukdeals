import { NextResponse } from 'next/server'
import { scrapeTabNow } from '@/lib/scraper'

export async function GET(request: Request) {
  const token = request.headers.get('x-cron-secret')
  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    const count = await scrapeTabNow('hot')
    return NextResponse.json({ tab: 'hot', count })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
