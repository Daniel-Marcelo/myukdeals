'use client'

import { useEffect, useRef, useState } from 'react'
import { Flame, TrendingUp, Bookmark, MoreHorizontal, RotateCcw, LogOut, Store } from 'lucide-react'
import DealFeed from '@/components/DealFeed'
import SavedFeed from '@/components/SavedFeed'
import SwipeTutorial from '@/components/SwipeTutorial'
import BlockedMerchantsModal from '@/components/BlockedMerchantsModal'
import { createClient } from '@/lib/supabase-browser'
import { useRouter, usePathname } from 'next/navigation'

type ActiveTab = 'hot' | 'trending' | 'saved'

export default function HomePage() {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const [blockedModalOpen, setBlockedModalOpen] = useState(false)
  const [feedKey, setFeedKey] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // On iOS standalone launch the layout viewport starts short and grows once the
  // app is fully presented, so a `fixed bottom-0` bar paints high and then snaps
  // down. Keep it hidden until innerHeight stops changing.
  const [navReady, setNavReady] = useState(false)
  useEffect(() => {
    let lastHeight = window.innerHeight
    let stableTicks = 0
    const interval = setInterval(() => {
      if (window.innerHeight === lastHeight) {
        if (++stableTicks >= 2) finish()
      } else {
        lastHeight = window.innerHeight
        stableTicks = 0
      }
    }, 60)
    // Don't leave the bar hidden if the viewport never settles.
    const fallback = setTimeout(finish, 800)
    function finish() {
      clearInterval(interval)
      clearTimeout(fallback)
      setNavReady(true)
    }
    return () => { clearInterval(interval); clearTimeout(fallback) }
  }, [])

  const activeTab: ActiveTab =
    pathname === '/trending' ? 'trending' :
    pathname === '/saved' ? 'saved' :
    'hot'

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth')
    router.refresh()
  }

  const handleResetDismissed = async () => {
    setMenuOpen(false)
    await fetch('/api/reset-dismissed', { method: 'POST' })
    // Remount DealFeed so its session-dismissed set is cleared and it refetches;
    // router.refresh() alone would leave that client-side set hiding the deals.
    setFeedKey(k => k + 1)
  }

  return (
    <main className="min-h-dvh bg-[#0a0a0f]">
      <SwipeTutorial />
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06] px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-white">MyUKDeals</span>

        {/* Overflow menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.06] text-[#8a8f98] hover:bg-white/[0.1] hover:text-white transition-all cursor-pointer"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-40 w-48 bg-[#16161e] border border-white/[0.08] rounded-xl shadow-xl overflow-hidden">
                <button
                  onClick={handleResetDismissed}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[#ededef] hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#8a8f98]" />
                  Reset dismissed
                </button>
                <div className="border-t border-white/[0.06]" />
                <button
                  onClick={() => { setMenuOpen(false); setBlockedModalOpen(true) }}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[#ededef] hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  <Store className="w-3.5 h-3.5 text-[#8a8f98]" />
                  Blocked retailers
                </button>
                <div className="border-t border-white/[0.06]" />
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="pb-20">
        {activeTab === 'saved' ? (
          <SavedFeed />
        ) : (
          <DealFeed key={feedKey} tab={activeTab} />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav
        className={`fixed bottom-0 inset-x-0 z-20 bg-[#0a0a0f]/80 backdrop-blur-xl border-t border-white/[0.06] flex items-center justify-around px-6 pt-2 transition-opacity duration-150 ${
          navReady ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <button
          onClick={() => router.push('/')}
          className={`flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-all duration-200 cursor-pointer ${
            activeTab === 'hot' ? 'text-indigo-400' : 'text-[#8a8f98] hover:text-white'
          }`}
        >
          <Flame className="w-5 h-5" />
          <span className="text-[10px] font-medium">Hot</span>
        </button>
        <button
          onClick={() => router.push('/trending')}
          className={`flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-all duration-200 cursor-pointer ${
            activeTab === 'trending' ? 'text-indigo-400' : 'text-[#8a8f98] hover:text-white'
          }`}
        >
          <TrendingUp className="w-5 h-5" />
          <span className="text-[10px] font-medium">Trending</span>
        </button>
        <button
          onClick={() => router.push('/saved')}
          className={`flex flex-col items-center gap-1 px-5 py-1.5 rounded-xl transition-all duration-200 cursor-pointer ${
            activeTab === 'saved' ? 'text-indigo-400' : 'text-[#8a8f98] hover:text-white'
          }`}
        >
          <Bookmark className="w-5 h-5" />
          <span className="text-[10px] font-medium">Saved</span>
        </button>
      </nav>
      {blockedModalOpen && (
        <BlockedMerchantsModal
          onClose={() => setBlockedModalOpen(false)}
          onChanged={() => setFeedKey(k => k + 1)}
        />
      )}
    </main>
  )
}
