import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export async function POST(request: Request) {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { deal_id, deal } = await request.json()
  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })

  // Conflict on (user_id, deal_id) so re-saving refreshes the snapshot in place
  // instead of creating duplicate rows (which would render twice in Saved).
  const { error } = await client
    .from('saved')
    .upsert(
      { deal_id, user_id: user.id, deal_data: deal, saved_at: new Date().toISOString() },
      { onConflict: 'user_id,deal_id' }
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
