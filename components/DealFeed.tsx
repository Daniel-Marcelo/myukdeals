'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import DealCard from './DealCard'

type Deal = {
  id: string
  title: string
  price: string | null
  merchant: string | null
  temperature: number
  comment_count: number
  image_url: string | null
  deal_url: string
  tab: string
  posted_at: string | null
}

function SkeletonCard() {
  return (
    <div className="bg-[#111118] rounded-2xl border border-white/[0.06] p-3 flex gap-3">
      <div className="w-[72px] h-[72px] rounded-xl shimmer flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2 py-0.5">
        <div className="h-3.5 rounded-lg shimmer w-full" />
        <div className="h-3.5 rounded-lg shimmer w-4/5" />
        <div className="h-3 rounded-lg shimmer w-2/5 mt-1" />
      </div>
    </div>
  )
}

export default function DealFeed({ tab }: { tab: 'hot' | 'trending' }) {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [lastScraped, setLastScraped] = useState<string | null>(null)

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/deals?tab=${tab}`)
    const data = await res.json()
    setDeals(data.deals ?? [])
    setLastScraped(data.last_scraped_at ?? null)
    setLoading(false)
  }, [tab])

  useEffect(() => {
    fetchDeals()
  }, [fetchDeals])

  const handleDismiss = async (id: string) => {
    setDeals(prev => prev.filter(d => d.id !== id))
    await fetch('/api/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: id }),
    })
  }

  const handleSave = async (id: string) => {
    setDeals(prev => prev.filter(d => d.id !== id))
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: id }),
    })
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-3 py-4">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 px-6">
        <p className="text-base font-semibold text-[#ededef]">All caught up</p>
        <p className="text-sm text-[#8a8f98] mt-1 text-center">No new deals to review right now.</p>
        <button
          onClick={fetchDeals}
          className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-3 py-4">
      {lastScraped && (
        <p className="text-[11px] text-[#8a8f98]/60 text-center mb-3 flex items-center justify-center gap-1.5">
          Updated {formatAge(lastScraped)} ago
          <span className="opacity-30">·</span>
          <button
            onClick={fetchDeals}
            className="hover:text-[#8a8f98] transition-colors cursor-pointer"
          >
            refresh
          </button>
        </p>
      )}
      <div className="flex flex-col gap-3">
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            onDismiss={handleDismiss}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  )
}

function formatAge(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}
