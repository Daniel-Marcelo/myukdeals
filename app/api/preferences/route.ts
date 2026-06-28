import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await client
    .from('user_preferences')
    .select('blocked_merchants')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ blocked_merchants: data?.blocked_merchants ?? [] })
}

export async function PATCH(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { blocked_merchants } = await request.json()
  if (!Array.isArray(blocked_merchants)) {
    return NextResponse.json({ error: 'blocked_merchants must be an array' }, { status: 400 })
  }

  const normalised = blocked_merchants.map((m: string) => m.toLowerCase().trim())

  const { error } = await client
    .from('user_preferences')
    .upsert({ user_id: user.id, blocked_merchants: normalised, updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
