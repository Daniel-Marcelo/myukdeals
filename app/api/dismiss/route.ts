import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const { deal_id } = await request.json()
  if (!deal_id) return NextResponse.json({ error: 'deal_id required' }, { status: 400 })

  const { error } = await supabase.from('dismissed').insert({ deal_id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
