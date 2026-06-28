'use client'

import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import DealCard, { type Deal } from './DealCard'
import PullToRefresh from './PullToRefresh'

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

  const fetchDeals = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/deals?tab=${tab}`, { cache: 'no-store' })
    const data = await res.json()
    setDeals(data.deals ?? [])
    setLoading(false)
  }, [tab])

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/deals?tab=${tab}`, { cache: 'no-store' })
    const data = await res.json()
    setDeals(data.deals ?? [])
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

  const handleSave = async (deal: Deal) => {
    await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id: deal.id, deal }),
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

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="max-w-xl mx-auto px-3 py-4">
        {tab === 'trending' && (
          <div className="mb-4 px-1">
            <p className="text-sm font-semibold text-[#ededef]">Emerging deals</p>
            <p className="text-xs text-[#8a8f98] mt-0.5">Sorted by the time at which they reached 100°</p>
          </div>
        )}
        {deals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 px-6">
            <p className="text-base font-semibold text-[#ededef]">All caught up</p>
            <p className="text-sm text-[#8a8f98] mt-1 text-center">No new deals to review right now.</p>
            <button
              onClick={fetchDeals}
              className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button
              onClick={async () => {
                await fetch('/api/reset-dismissed', { method: 'POST' })
                fetchDeals()
              }}
              className="mt-3 text-xs text-[#8a8f98]/60 hover:text-[#8a8f98] transition-colors cursor-pointer"
            >
              Reset dismissed
            </button>
          </div>
        ) : (
          <AnimatePresence>
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
          </AnimatePresence>
        )}
      </div>
    </PullToRefresh>
  )
}
