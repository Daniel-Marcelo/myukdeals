import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tab = searchParams.get('tab') === 'trending' ? 'trending' : 'hot'

  const { data: dismissed } = await client.from('dismissed').select('deal_id')
  const dismissedIds = dismissed?.map((d) => d.deal_id) ?? []

  let query = supabase
    .from('deals')
    .select('*')
    .eq('tab', tab)
    .order(tab === 'trending' ? 'order_index' : 'temperature', { ascending: tab === 'trending' })
    .limit(150)

  if (dismissedIds.length > 0) {
    query = query.not('id', 'in', `(${dismissedIds.join(',')})`)
  }

  const { data: deals, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: meta } = await supabase
    .from('meta')
    .select('value')
    .eq('key', 'last_scraped_at')
    .single()

  return NextResponse.json({ deals, last_scraped_at: meta?.value })
}
