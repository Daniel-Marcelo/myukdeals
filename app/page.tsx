'use client'

import { useState } from 'react'
import { Flame, TrendingUp } from 'lucide-react'
import DealFeed from '@/components/DealFeed'

type Tab = 'hot' | 'trending'

export default function Home() {
  const [tab, setTab] = useState<Tab>('hot')

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-indigo-600">MyUKDeals</h1>
        <div className="flex gap-1 bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setTab('hot')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              tab === 'hot' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            <Flame className="w-3.5 h-3.5" /> Hot
          </button>
          <button
            onClick={() => setTab('trending')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              tab === 'trending' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-500'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" /> Trending
          </button>
        </div>
      </header>
      <DealFeed tab={tab} />
    </main>
  )
}
