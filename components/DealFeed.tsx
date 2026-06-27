'use client'

import { useEffect, useState, useCallback } from 'react'
import { CheckCircle2, RefreshCw } from 'lucide-react'
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
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm">Fetching deals…</p>
      </div>
    )
  }

  if (deals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <CheckCircle2 className="w-12 h-12 text-indigo-300 mb-3" />
        <p className="font-medium text-gray-600">You're all caught up!</p>
        <p className="text-sm mt-1">No more deals to review.</p>
        <button
          onClick={fetchDeals}
          className="mt-6 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-full text-sm font-medium"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-3 py-4">
      {lastScraped && (
        <p className="text-xs text-gray-400 text-center mb-3 flex items-center justify-center gap-1">
          Updated {formatAge(lastScraped)} ago ·
          <button onClick={fetchDeals} className="underline flex items-center gap-0.5">
            <RefreshCw className="w-3 h-3" /> refresh
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
