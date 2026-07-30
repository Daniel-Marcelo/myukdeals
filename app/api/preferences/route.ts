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

  // Keep the user's casing for display ("eBay", "ao" — no algorithm guesses those
  // right), but dedupe on the lowercased form, which is what isMerchantBlocked()
  // compares against. Bounded so a bad client can't write an unbounded array.
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const entry of blocked_merchants) {
    if (typeof entry !== 'string') continue
    const display = entry.trim().slice(0, 60)
    const key = display.toLowerCase()
    if (!display || seen.has(key)) continue
    seen.add(key)
    cleaned.push(display)
  }
  if (cleaned.length > 100) {
    return NextResponse.json({ error: 'Too many blocked retailers (max 100)' }, { status: 400 })
  }

  // No onConflict needed: user_id is the table's primary key.
  const { error } = await client
    .from('user_preferences')
    .upsert({ user_id: user.id, blocked_merchants: cleaned, updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
