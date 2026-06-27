'use client'

import { useState } from 'react'
import { Flame, TrendingUp } from 'lucide-react'
import DealFeed from '@/components/DealFeed'

type Tab = 'hot' | 'trending'

export default function Home() {
  const [tab, setTab] = useState<Tab>('hot')

  return (
    <main className="min-h-dvh bg-[#0a0a0f]">
      <header className="sticky top-0 z-20 bg-[#0a0a0f]/80 backdrop-blur-xl border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-white">MyUKDeals</span>
        <div className="flex gap-1 bg-white/[0.06] rounded-full p-1">
          <button
            onClick={() => setTab('hot')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              tab === 'hot'
                ? 'bg-indigo-600 text-white'
                : 'text-[#8a8f98] hover:text-white'
            }`}
          >
            <Flame className="w-3 h-3" /> Hot
          </button>
          <button
            onClick={() => setTab('trending')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
              tab === 'trending'
                ? 'bg-indigo-600 text-white'
                : 'text-[#8a8f98] hover:text-white'
            }`}
          >
            <TrendingUp className="w-3 h-3" /> Trending
          </button>
        </div>
      </header>
      <DealFeed tab={tab} />
    </main>
  )
}
