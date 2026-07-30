'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { Flame, MessageCircle, BookmarkX, ShoppingBag, ArrowUpRight, Clock, AlertCircle, RefreshCw } from 'lucide-react'
import { useMotionValue, useTransform, motion, animate, AnimatePresence, type PanInfo } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { type Deal } from './DealCard'
import PullToRefresh from './PullToRefresh'
import { useFeedReset } from './FeedResetContext'
import { fetchJson, AuthError } from '@/lib/api'
import { formatAge } from '@/lib/format'

type SavedItem = {
  deal_id: string
  deal_data: Deal | null
  saved_at: string | null
}


function SavedCard({ item, onUnsave }: { item: SavedItem; onUnsave: (id: string) => void }) {
  const deal = item.deal_data
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-150, 150], [-4, 4])
  const unsaveOpacity = useTransform(x, [-80, -20], [1, 0])

  if (!deal) return null

  const unsave = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10)
    animate(x, -600, { duration: 0.3, ease: 'easeOut' })
    setTimeout(() => onUnsave(item.deal_id), 300)
  }

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.x < -80) unsave()
    else animate(x, 0, { type: 'spring', damping: 25, stiffness: 200 })
  }

  return (
    <motion.div
      layout
      transition={{ layout: { type: 'spring', duration: 1, bounce: 0.1 } }}
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ right: 0 }}
      onDragEnd={handleDragEnd}
      className="relative bg-[#111118] rounded-2xl border border-white/[0.06] overflow-hidden cursor-grab active:cursor-grabbing select-none"
    >
      <motion.div
        style={{ opacity: unsaveOpacity }}
        className="absolute inset-0 bg-red-500/10 z-10 pointer-events-none flex items-center justify-end pr-4"
      >
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
          <BookmarkX className="w-5 h-5 text-red-400" />
        </div>
      </motion.div>

      <div className="flex gap-3 p-3">
        <div className="relative w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden bg-white/[0.04]">
          {deal.image_url ? (
            <Image src={deal.image_url} alt={deal.title} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-white/20" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col py-0.5 gap-1.5">
          <p className="text-sm font-medium text-[#ededef] line-clamp-2 leading-snug tracking-tight">
            {deal.title}
          </p>
          <div className="flex items-center gap-1.5">
            {deal.price && (
              deal.price === 'FREE' ? (
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-bold ring-1 ring-emerald-500/20 tracking-wide">
                  FREE
                </span>
              ) : (
                <span className="text-sm font-bold text-white">{deal.price}</span>
              )
            )}
            {deal.merchant && (
              <span className="text-xs text-[#8a8f98]">{deal.merchant}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[11px] font-semibold ring-1 ring-amber-500/20">
              <Flame className="w-2.5 h-2.5" />
              {deal.temperature}°
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[#8a8f98]">
              <MessageCircle className="w-2.5 h-2.5" />
              {deal.comment_count ?? 0}
            </span>
            <a
              href={deal.deal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="ml-auto flex items-center gap-0.5 text-sm text-indigo-400 hover:text-indigo-300 font-semibold transition-colors min-h-[44px] min-w-[44px] justify-end"
            >
              View <ArrowUpRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-3">
        {item.saved_at && (
          <span className="flex items-center gap-1 text-[11px] text-[#8a8f98]/50">
            <Clock className="w-2.5 h-2.5" />
            Saved {formatAge(item.saved_at)}
          </span>
        )}
        <button
          onClick={unsave}
          aria-label="Remove from saved"
          className="w-11 h-11 rounded-full bg-white/[0.04] text-[#8a8f98] hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center"
        >
          <BookmarkX className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  )
}

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

export default function SavedFeed() {
  const router = useRouter()
  const resetToken = useFeedReset()
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSaved = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ saved: SavedItem[] }>('/api/saved')
      setItems(data.saved ?? [])
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not load saved deals')
    } finally {
      setLoading(false)
    }
  }, [router])

  const refresh = useCallback(async () => {
    try {
      const data = await fetchJson<{ saved: SavedItem[] }>('/api/saved')
      setItems(data.saved ?? [])
      setError(null)
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setError(err instanceof Error ? err.message : 'Could not refresh')
    }
  }, [router])

  useEffect(() => {
    // Fetch-on-mount: the feed owns its own data loading, so the state update is
    // the point, not an accident. The rule targets cascading synchronous renders;
    // this setState lands in an async continuation after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSaved()
  }, [fetchSaved])

  // Resync when the shell signals a reset (it no longer remounts us).
  useEffect(() => {
    if (resetToken === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSaved()
  }, [resetToken, fetchSaved])

  const handleUnsave = async (deal_id: string) => {
    const prev = items
    setItems(cur => cur.filter(i => i.deal_id !== deal_id)) // optimistic
    try {
      await fetchJson('/api/unsave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deal_id }),
      })
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setItems(prev) // roll back
      setError('Could not remove — try again')
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl mx-auto px-3 py-4">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <div className="max-w-xl mx-auto px-3 py-4">
        {items.length === 0 && error ? (
          <div className="flex flex-col items-center justify-center py-28 px-6">
            <AlertCircle className="w-8 h-8 text-red-400/80" />
            <p className="text-base font-semibold text-[#ededef] mt-3">Couldn&apos;t load saved</p>
            <p className="text-sm text-[#8a8f98] mt-1 text-center">{error}</p>
            <button
              onClick={() => fetchSaved()}
              className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 px-6 gap-4">
            <p className="text-base font-semibold text-[#ededef]">No saved deals</p>
            <p className="text-sm text-[#8a8f98] text-center">Swipe right on a deal to save it for later.</p>
            {/* Animated swipe hint */}
            <div className="flex items-center gap-2 mt-2">
              <div className="w-10 h-10 rounded-full bg-[#111118] border border-white/[0.06] flex items-center justify-center">
                <ShoppingBag className="w-4 h-4 text-white/30" />
              </div>
              <motion.div
                animate={{ x: [0, 28, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }}
                className="flex items-center gap-1 text-emerald-400/70"
              >
                <ArrowUpRight className="w-4 h-4 rotate-180" />
                <span className="text-xs font-medium">swipe right</span>
              </motion.div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <AnimatePresence>
              {items.map(item => (
                <SavedCard key={item.deal_id} item={item} onUnsave={handleUnsave} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </PullToRefresh>
  )
}
