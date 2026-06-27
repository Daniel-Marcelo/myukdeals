import { NextResponse } from 'next/server'
import { scrapeNow } from '@/lib/scraper'

export async function GET(request: Request) {
  const token = request.headers.get('x-cron-secret')
  if (token !== process.env.CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await scrapeNow()
  return NextResponse.json(result)
}
