'use client'

import { Flame, TrendingUp, LogOut } from 'lucide-react'
import DealFeed from '@/components/DealFeed'
import { createClient } from '@/lib/supabase-browser'
import { useRouter, usePathname } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const pathname = usePathname()
  const tab = pathname === '/trending' ? 'trending' : 'hot'

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  return (
    <main className="min-h-dvh bg-[#0a0a0f]">
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-white">MyUKDeals</span>
        <div className="flex gap-1 bg-white/[0.06] rounded-full p-1">
          <button
            onClick={() => router.push('/')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              tab === 'hot'
                ? 'bg-indigo-600 text-white'
                : 'text-[#8a8f98] hover:text-white'
            }`}
          >
            <Flame className="w-3 h-3" /> Hot
          </button>
          <button
            onClick={() => router.push('/trending')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              tab === 'trending'
                ? 'bg-indigo-600 text-white'
                : 'text-[#8a8f98] hover:text-white'
            }`}
          >
            <TrendingUp className="w-3 h-3" /> Trending
          </button>
        </div>
        <button
          onClick={handleSignOut}
          title="Sign out"
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.06] text-[#8a8f98] hover:bg-white/[0.1] hover:text-white transition-all cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </header>
      <DealFeed tab={tab} />
    </main>
  )
}
