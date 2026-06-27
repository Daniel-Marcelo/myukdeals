'use client'

import { useMotionValue, useTransform, motion } from 'framer-motion'
import Image from 'next/image'
import { Flame, MessageCircle, X, Bookmark, ShoppingBag, ExternalLink } from 'lucide-react'

type Deal = {
  id: string
  title: string
  price: string | null
  merchant: string | null
  temperature: number
  comment_count: number
  image_url: string | null
  deal_url: string
  posted_at: string | null
}

export default function DealCard({
  deal,
  onDismiss,
  onSave,
}: {
  deal: Deal
  onDismiss: (id: string) => void
  onSave: (id: string) => void
}) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-150, 150], [-6, 6])
  const dismissOpacity = useTransform(x, [-80, -20], [1, 0])
  const saveOpacity = useTransform(x, [20, 80], [0, 1])

  const handleDragEnd = (_: any, info: { offset: { x: number } }) => {
    if (info.offset.x < -80) onDismiss(deal.id)
    else if (info.offset.x > 80) onSave(deal.id)
  }

  return (
    <motion.div
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      className="relative bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden cursor-grab active:cursor-grabbing select-none"
    >
      {/* Swipe indicators */}
      <motion.div style={{ opacity: dismissOpacity }} className="absolute inset-0 bg-red-50 z-10 pointer-events-none flex items-center justify-end pr-6">
        <X className="w-8 h-8 text-red-400" />
      </motion.div>
      <motion.div style={{ opacity: saveOpacity }} className="absolute inset-0 bg-indigo-50 z-10 pointer-events-none flex items-center pl-6">
        <Bookmark className="w-8 h-8 text-indigo-500" />
      </motion.div>

      <div className="flex gap-3 p-3">
        {/* Image */}
        <div className="relative w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
          {deal.image_url ? (
            <Image src={deal.image_url} alt={deal.title} fill className="object-cover" unoptimized />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ShoppingBag className="w-8 h-8 text-gray-300" />
            </div>
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">{deal.title}</p>
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              {deal.price && <span className="text-base font-bold text-indigo-600">{deal.price}</span>}
              {deal.merchant && <span className="text-xs text-gray-400">{deal.merchant}</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold">
                <Flame className="w-3.5 h-3.5" />{deal.temperature}
              </span>
              <span className="flex items-center gap-0.5 text-xs text-gray-400">
                <MessageCircle className="w-3 h-3" />{deal.comment_count ?? 0}
              </span>
              <a
                href={deal.deal_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-0.5 text-xs text-indigo-500 font-medium hover:underline"
              >
                View <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex border-t border-gray-100 divide-x divide-gray-100">
        <button
          onClick={() => onDismiss(deal.id)}
          className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:bg-red-50 hover:text-red-400 transition-colors"
        >
          <X className="w-4 h-4" /> Dismiss
        </button>
        <button
          onClick={() => onSave(deal.id)}
          className="flex-1 py-2.5 flex items-center justify-center gap-1.5 text-sm text-gray-400 hover:bg-indigo-50 hover:text-indigo-500 transition-colors"
        >
          <Bookmark className="w-4 h-4" /> Save
        </button>
      </div>
    </motion.div>
  )
}
