import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client — BYPASSES Row Level Security. Never import this into a
// client component or any module that runs in the browser. The `server-only`
// import above turns any such import into a build error. Server code only
// (the scraper and cron routes).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
