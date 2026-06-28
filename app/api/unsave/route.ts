import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { deal_id } = await request.json()
  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })

  const { error } = await client
    .from('saved')
    .delete()
    .eq('deal_id', deal_id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
