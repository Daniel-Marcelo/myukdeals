import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') === 'trending' ? 'trending' : 'hot'

  const [{ data: dismissed }, { data: prefs }] = await Promise.all([
    client.from('dismissed').select('deal_id'),
    client.from('user_preferences').select('blocked_merchants').eq('user_id', user.id).maybeSingle(),
  ])

  const dismissedIds = dismissed?.map((d) => d.deal_id) ?? []
  const blockedMerchants = prefs?.blocked_merchants ?? []

  let query = supabase
    .from('deals')
    .select('*')
    .eq('tab', tab)
    .order(tab === 'trending' ? 'order_index' : 'temperature', { ascending: tab === 'trending' })
    .limit(150)

  if (dismissedIds.length > 0) {
    query = query.not('id', 'in', `(${dismissedIds.join(',')})`)
  }

  const { data: rawDeals, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deals = blockedMerchants.length > 0
    ? (rawDeals ?? []).filter(d => !d.merchant || !blockedMerchants.includes(d.merchant.toLowerCase().trim()))
    : rawDeals

  return NextResponse.json({ deals }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
