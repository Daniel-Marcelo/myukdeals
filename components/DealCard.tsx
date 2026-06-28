'use client'

import { useMotionValue, useTransform, motion, animate } from 'framer-motion'
import { useState } from 'react'
import Image from 'next/image'
import { Flame, MessageCircle, X, Bookmark, ShoppingBag, ArrowUpRight, TrendingUp } from 'lucide-react'

export type Deal = {
  id: string
  title: string
  price: string | null
  merchant: string | null
  temperature: number
  comment_count: number
  image_url: string | null
  deal_url: string
  posted_at: string | null
  trending_for: string | null
}

function formatAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function DealCard({
  deal,
  onDismiss,
  onSave,
}: {
  deal: Deal
  onDismiss: (id: string) => void
  onSave: (deal: Deal) => void
}) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-150, 150], [-4, 4])
  const dismissOpacity = useTransform(x, [-80, -20], [1, 0])
  const saveOpacity = useTransform(x, [20, 80], [0, 1])

  const [justSaved, setJustSaved] = useState(false)

  const dismiss = () => {
    animate(x, -600, { duration: 0.3, ease: 'easeOut' })
    setTimeout(() => onDismiss(deal.id), 300)
  }

  const save = () => {
    animate(x, 0, { type: 'spring', damping: 20, stiffness: 300 })
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1000)
    onSave(deal)
  }

  const handleDragEnd = (_: any, info: { offset: { x: number } }) => {
    if (info.offset.x < -80) dismiss()
    else if (info.offset.x > 80) save()
    else animate(x, 0, { type: 'spring', damping: 25, stiffness: 200 })
  }

  return (
    <motion.div
      layout
      transition={{ layout: { type: 'spring', duration: 1, bounce: 0.1 } }}
      style={{ x, rotate }}
      drag="x"
      onDragEnd={handleDragEnd}
      className="relative bg-[#111118] rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing select-none border border-white/[0.06]"
    >
      {/* Swipe overlays */}
      <motion.div
        style={{ opacity: dismissOpacity }}
        className="absolute inset-0 bg-red-500/10 z-10 pointer-events-none flex items-center justify-end pr-4"
      >
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
          <X className="w-5 h-5 text-red-400" />
        </div>
      </motion.div>
      <motion.div
        style={{ opacity: saveOpacity }}
        className="absolute inset-0 bg-emerald-500/10 z-10 pointer-events-none flex items-center pl-4"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Bookmark className="w-5 h-5 text-emerald-400" />
        </div>
      </motion.div>

      {/* Main content */}
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
            {deal.posted_at && (
              <span className="text-xs text-[#8a8f98]/50 ml-auto">{formatAge(deal.posted_at)}</span>
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
            {deal.trending_for && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 text-[11px] font-medium ring-1 ring-indigo-500/20">
                <TrendingUp className="w-2.5 h-2.5" />
                {deal.trending_for}
              </span>
            )}
            <a
              href={deal.deal_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="ml-auto flex items-center gap-0.5 text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
            >
              View <ArrowUpRight className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between px-3 pb-3">
        <button
          onClick={dismiss}
          aria-label="Dismiss deal"
          className="w-9 h-9 rounded-full bg-white/[0.04] text-[#8a8f98] hover:bg-red-500/10 hover:text-red-400 transition-all cursor-pointer flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          onClick={save}
          aria-label="Save deal"
          className={`w-9 h-9 rounded-full transition-all cursor-pointer flex items-center justify-center ${
            justSaved
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-white/[0.04] text-[#8a8f98] hover:bg-indigo-500/10 hover:text-indigo-400'
          }`}
        >
          <Bookmark className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  )
}
