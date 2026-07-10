'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { RefreshCw, AlertCircle, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import DealCard, { type Deal } from './DealCard'
import PullToRefresh from './PullToRefresh'
import { fetchJson, AuthError } from '@/lib/api'
import { formatAge } from '@/lib/format'

type DealsResponse = { deals: Deal[]; last_scraped_at: string | null; refreshing: boolean }

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
  const router = useRouter()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'today' | 'week'>('today')
  const [lastScrapedAt, setLastScrapedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refetchedKeys = useRef<Set<string>>(new Set())

  const applyResponse = (data: DealsResponse) => {
    setDeals(data.deals ?? [])
    setLastScrapedAt(data.last_scraped_at ?? null)
    setRefreshing(Boolean(data.refreshing))
  }

  const fetchDeals = useCallback(async (p?: 'today' | 'week') => {
    const activePeriod = p ?? period
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<DealsResponse>(`/api/deals?tab=${tab}&period=${activePeriod}`)
      applyResponse(data)
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not load deals')
    } finally {
      setLoading(false)
    }
  }, [tab, period, router])

  // Used by pull-to-refresh and the auto re-fetch — no full-screen skeleton.
  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<DealsResponse>(`/api/deals?tab=${tab}&period=${period}`)
      applyResponse(data)
      setError(null)
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not refresh')
    }
  }, [tab, period, router])

  const handlePeriodChange = (p: 'today' | 'week') => {
    setPeriod(p)
    fetchDeals(p)
  }

  useEffect(() => {
    fetchDeals()
  }, [fetchDeals])

  // When the server reports it kicked off a background scrape (refreshing), pull
  // fresh data once ~20s later. Guarded per tab:period so a persistently failing
  // scrape can't turn this into a poll loop.
  useEffect(() => {
    if (!refreshing) return
    const key = `${tab}:${period}`
    if (refetchedKeys.current.has(key)) return
    refetchedKeys.current.add(key)
    const t = setTimeout(() => { refresh() }, 20000)
    return () => clearTimeout(t)
  }, [refreshing, tab, period, refresh])

  const handleDismiss = async (id: string) => {
    const prev = deals
    setDeals(cur => cur.filter(d => d.id !== id)) // optimistic
    try {
      await fetchJson('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: id }),
      })
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setDeals(prev) // roll back — the deal is still live
      setError('Could not dismiss — try again')
    }
  }

  const handleSave = async (deal: Deal): Promise<boolean> => {
    try {
      await fetchJson('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: deal.id, deal }),
      })
      return true
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return false }
      setError('Could not save — try again')
      return false
    }
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
        <div className="mb-4 px-1 flex items-center justify-between">
          {tab === 'trending' ? (
            <div>
              <p className="text-sm font-semibold text-[#ededef]">Emerging deals</p>
              <p className="text-xs text-[#8a8f98] mt-0.5">Sorted by the time at which they reached 100°</p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[#ededef]">Hot deals</p>
              <div className="flex items-center bg-white/[0.06] rounded-lg p-0.5">
                <button
                  onClick={() => handlePeriodChange('today')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${period === 'today' ? 'bg-indigo-600 text-white' : 'text-[#8a8f98] hover:text-white'}`}
                >
                  Today
                </button>
                <button
                  onClick={() => handlePeriodChange('week')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${period === 'week' ? 'bg-indigo-600 text-white' : 'text-[#8a8f98] hover:text-white'}`}
                >
                  Week
                </button>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {refreshing && <RefreshCw className="w-3 h-3 text-[#8a8f98]/60 animate-spin" />}
            {lastScrapedAt && (
              <span className="text-xs text-[#8a8f98]/60">Updated {formatAge(lastScrapedAt)}</span>
            )}
            <span className="text-xs text-[#8a8f98]/60">{deals.length} deal{deals.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {error && deals.length > 0 && (
          <button
            onClick={() => setError(null)}
            className="mb-3 w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-xs cursor-pointer"
          >
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="flex-1 text-left">{error}</span>
            <X className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        )}

        {deals.length === 0 ? (
          error ? (
            <div className="flex flex-col items-center justify-center py-28 px-6">
              <AlertCircle className="w-8 h-8 text-red-400/80" />
              <p className="text-base font-semibold text-[#ededef] mt-3">Couldn&apos;t load deals</p>
              <p className="text-sm text-[#8a8f98] mt-1 text-center">{error}</p>
              <button
                onClick={() => fetchDeals()}
                className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-28 px-6">
              <p className="text-base font-semibold text-[#ededef]">All caught up</p>
              <p className="text-sm text-[#8a8f98] mt-1 text-center">No new deals to review right now.</p>
              <button
                onClick={() => fetchDeals()}
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
          )
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {deals.map(deal => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onDismiss={handleDismiss}
                  onSave={handleSave}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </PullToRefresh>
  )
}
