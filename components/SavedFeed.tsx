'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { Flame, MessageCircle, BookmarkX, ShoppingBag, ArrowUpRight } from 'lucide-react'
import { type Deal } from './DealCard'

type SavedItem = {
  deal_id: string
  deal_data: Deal | null
  created_at: string
}

function formatAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function SavedCard({ item, onUnsave }: { item: SavedItem; onUnsave: (id: string) => void }) {
  const deal = item.deal_data
  if (!deal) return null

  return (
    <div className="bg-[#111118] rounded-2xl border border-white/[0.06]">
      <div className="flex gap-3 p-3">
        <div className="relative w-[72px] h-[72px] flex-shrink-0 rounded-xl overflow-hidden bg-white/[0.04]">
          {deal.image_url ? (
            <Image src={deal.image_url} alt={deal.title} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-7 h-7 text-white/20" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col py-0.5 gap-1.5">
          <p className="text-sm font-medium text-[#ededef] line-clamp-2 leading-snug tracking-tight">
            {deal.title}
          </p>
          <div className="flex items-center gap-1.5">
            {deal.price && (
              <span className="text-sm font-bold text-white">{deal.price}</span>
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
              className="ml-auto flex items-center gap-0.5 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              View <ArrowUpRight className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-3">
        <span className="text-[11px] text-[#8a8f98]/50">Saved {formatAge(item.created_at)}</span>
        <button
          onClick={() => onUnsave(item.deal_id)}
          aria-label="Remove from saved"
          className="w-9 h-9 rounded-full bg-white/[0.04] text-[#8a8f98] hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center"
        >
          <BookmarkX className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
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

export default function SavedFeed() {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSaved = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/saved', { cache: 'no-store' })
    const data = await res.json()
    setItems(data.saved ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSaved()
  }, [fetchSaved])

  const handleUnsave = async (deal_id: string) => {
    setItems(prev => prev.filter(i => i.deal_id !== deal_id))
    await fetch('/api/unsave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deal_id }),
    })
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

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 px-6">
        <p className="text-base font-semibold text-[#ededef]">No saved deals</p>
        <p className="text-sm text-[#8a8f98] mt-1 text-center">Swipe right on a deal to save it.</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-3 py-4">
      <div className="flex flex-col gap-3">
        {items.map(item => (
          <SavedCard key={item.deal_id} item={item} onUnsave={handleUnsave} />
        ))}
      </div>
    </div>
  )
}
