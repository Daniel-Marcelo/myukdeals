'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { RefreshCw, AlertCircle, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import DealCard, { type Deal } from './DealCard'
import PullToRefresh from './PullToRefresh'
import { useFeedReset } from './FeedResetContext'
import { fetchJson, AuthError } from '@/lib/api'
import { formatAge } from '@/lib/format'

type DealsResponse = { deals: Deal[]; last_scraped_at: string | null; refreshing: boolean }

const POLL_DELAYS_MS = [5000, 8000, 12000, 20000, 30000]

// Module scope, so both survive the remount that a tab navigation causes —
// /, /trending and /saved are sibling route segments, so this component is torn
// down and rebuilt on every tab switch even though the shell around it persists.

// Last response per tab:period. Purely a paint optimisation: every cache hit is
// revalidated immediately, and a full reload clears it.
const feedCache = new Map<string, DealsResponse>()

// Deals dismissed this session. The server also filters dismissed deals, but a
// tab/period switch can refetch before the dismiss row commits — this set keeps
// a just-dismissed deal from flashing back on the other feed. Keyed on deal_id,
// which is shared across feeds, so it hides the deal everywhere.
const dismissedThisSession = new Set<string>()

function SkeletonCard() {
  return (
    <div className="bg-[#111118] rounded-2xl border border-white/[0.06] p-3 flex gap-3">
      <div className="w-24 h-24 rounded-xl shimmer flex-shrink-0" />
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
  const resetToken = useFeedReset()
  const cached = feedCache.get(`${tab}:today`)
  const [deals, setDeals] = useState<Deal[]>(
    () => (cached?.deals ?? []).filter(d => !dismissedThisSession.has(String(d.id)))
  )
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<'today' | 'week'>('today')
  const [lastScrapedAt, setLastScrapedAt] = useState<string | null>(cached?.last_scraped_at ?? null)
  const [refreshing, setRefreshing] = useState(false)
  // Bounded backoff for the "a background scrape is running" case. We poll until
  // last_scraped_at actually ADVANCES past the value we started with — the server
  // writes it only after a scrape commits, so it's a truthful completion signal.
  // Budget totals ~75s, deliberately longer than a worst-case scrape.
  const pollAttempt = useRef(0)
  const pollBaseline = useRef<string | null>(null)

  const applyResponse = useCallback((data: DealsResponse, activePeriod: 'today' | 'week') => {
    feedCache.set(`${tab}:${activePeriod}`, data)
    setDeals((data.deals ?? []).filter(d => !dismissedThisSession.has(String(d.id))))
    setLastScrapedAt(data.last_scraped_at ?? null)
    setRefreshing(Boolean(data.refreshing))
  }, [tab])

  const fetchDeals = useCallback(async (p?: 'today' | 'week') => {
    const activePeriod = p ?? period
    // A new feed gets a full poll budget.
    pollAttempt.current = 0
    pollBaseline.current = null
    // Only show the skeleton when there's nothing cached to paint.
    if (!feedCache.has(`${tab}:${activePeriod}`)) setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<DealsResponse>(`/api/deals?tab=${tab}&period=${activePeriod}`)
      applyResponse(data, activePeriod)
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not load deals')
    } finally {
      setLoading(false)
    }
  }, [tab, period, router, applyResponse])

  // Used by pull-to-refresh and the auto re-fetch — no full-screen skeleton.
  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<DealsResponse>(`/api/deals?tab=${tab}&period=${period}`)
      applyResponse(data, period)
      setError(null)
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not refresh')
    }
  }, [tab, period, router, applyResponse])

  const handlePeriodChange = (p: 'today' | 'week') => {
    setPeriod(p)
    fetchDeals(p)
  }

  useEffect(() => {
    // Fetch-on-mount: the feed owns its own data loading, so the state update is
    // the point, not an accident. The rule targets cascading synchronous renders;
    // this setState lands in an async continuation after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDeals()
  }, [fetchDeals])

  // "Reset dismissed" / blocked-retailer changes come from the shell, which no
  // longer remounts us. Clear the session set and refetch instead.
  useEffect(() => {
    if (resetToken === 0) return // initial mount — fetchDeals already ran
    dismissedThisSession.clear()
    feedCache.clear()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDeals()
    // fetchDeals is intentionally omitted: it changes identity on every period
    // switch, and re-running this effect then would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken])

  // When the server reports it kicked off a background scrape (refreshing), poll
  // with backoff until last_scraped_at advances — that only happens once the
  // scrape has committed. Bounded, so a persistently failing scrape can't turn
  // this into an endless poll loop.
  useEffect(() => {
    if (!refreshing) {
      pollAttempt.current = 0
      pollBaseline.current = null
      return
    }
    // First tick of a refresh cycle: remember what "stale" looked like.
    if (pollBaseline.current === null) pollBaseline.current = lastScrapedAt ?? ''

    // The scrape landed — stop polling.
    if (lastScrapedAt && lastScrapedAt !== pollBaseline.current) {
      pollAttempt.current = 0
      pollBaseline.current = null
      return
    }

    const delay = POLL_DELAYS_MS[pollAttempt.current]
    if (delay === undefined) return // budget exhausted — pull-to-refresh still works

    pollAttempt.current += 1
    const t = setTimeout(() => {
      // Don't burn requests while the PWA is backgrounded on the phone.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      refresh()
    }, delay)
    return () => clearTimeout(t)
  }, [refreshing, lastScrapedAt, tab, period, refresh])

  const handleDismiss = async (id: string) => {
    const prev = deals
    dismissedThisSession.add(String(id))
    setDeals(cur => cur.filter(d => d.id !== id)) // optimistic
    try {
      await fetchJson('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id: id }),
      })
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      dismissedThisSession.delete(String(id))
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
                  try {
                    await fetchJson('/api/reset-dismissed', { method: 'POST' })
                  } catch (err) {
                    if (err instanceof AuthError) { router.push('/auth'); return }
                    setError('Could not reset — try again')
                    return
                  }
                  dismissedThisSession.clear()
                  feedCache.clear()
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
