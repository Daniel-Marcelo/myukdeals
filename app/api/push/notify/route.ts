import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { webpush } from '@/lib/webpush'

export const dynamic = 'force-dynamic'

const THRESHOLD = parseInt(process.env.NOTIFY_TEMP_THRESHOLD ?? '500', 10)

export async function POST() {
  const [{ data: subs }, { data: hotDeals }, { data: alreadyNotified }] = await Promise.all([
    supabase.from('push_subscriptions').select('subscription'),
    supabase
      .from('deals')
      .select('id, title, price, merchant, temperature, url')
      .gte('temperature', THRESHOLD)
      .order('temperature', { ascending: false })
      .limit(20),
    supabase.from('notified_deals').select('deal_id'),
  ])

  if (!subs?.length || !hotDeals?.length) return NextResponse.json({ sent: 0 })

  const notifiedIds = new Set(alreadyNotified?.map((r) => r.deal_id) ?? [])
  const newDeals = hotDeals.filter((d) => !notifiedIds.has(d.id))

  if (!newDeals.length) return NextResponse.json({ sent: 0 })

  // Mark as notified first to avoid double-sends on concurrent calls
  await supabase.from('notified_deals').insert(newDeals.map((d) => ({ deal_id: d.id })))

  let sent = 0
  for (const deal of newDeals) {
    const payload = JSON.stringify({
      title: `🔥 ${Math.round(deal.temperature)}° deal`,
      body: [deal.title, deal.price, deal.merchant].filter(Boolean).join(' · '),
      url: deal.url ?? '/',
    })

    for (const { subscription } of subs) {
      try {
        await webpush.sendNotification(subscription, payload)
        sent++
      } catch (err: unknown) {
        // 410 Gone = subscription expired, remove it
        if ((err as { statusCode?: number }).statusCode === 410) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('endpoint', subscription.endpoint)
        }
      }
    }
  }

  return NextResponse.json({ sent, deals: newDeals.length })
}

// Also allow GET for Vercel cron
export async function GET() {
  return POST()
}
