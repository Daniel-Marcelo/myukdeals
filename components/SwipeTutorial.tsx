'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'
import { X, Bookmark, ShoppingBag, Flame } from 'lucide-react'

const STORAGE_KEY = 'swipe_tutorial_seen'

function DemoCard({ x }: { x: ReturnType<typeof useMotionValue<number>> }) {
  const rotate = useTransform(x, [-150, 150], [-4, 4])
  const dismissOpacity = useTransform(x, [-80, -20], [1, 0])
  const saveOpacity = useTransform(x, [20, 80], [0, 1])

  return (
    <motion.div
      style={{ x, rotate }}
      className="relative bg-[#111118] rounded-2xl overflow-hidden border border-white/[0.06] pointer-events-none select-none"
    >
      <motion.div
        style={{ opacity: dismissOpacity }}
        className="absolute inset-0 bg-red-500/10 z-10 flex items-center justify-end pr-4"
      >
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
          <X className="w-5 h-5 text-red-400" />
        </div>
      </motion.div>
      <motion.div
        style={{ opacity: saveOpacity }}
        className="absolute inset-0 bg-emerald-500/10 z-10 flex items-center pl-4"
      >
        <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Bookmark className="w-5 h-5 text-emerald-400" />
        </div>
      </motion.div>

      <div className="flex gap-3 p-3">
        <div className="w-[72px] h-[72px] flex-shrink-0 rounded-xl overflow-hidden bg-white/[0.04] flex items-center justify-center">
          <ShoppingBag className="w-7 h-7 text-white/20" />
        </div>
        <div className="flex-1 min-w-0 flex flex-col py-0.5 gap-1.5">
          <p className="text-sm font-medium text-[#ededef] leading-snug tracking-tight">
            Samsung 65" QLED 4K TV
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-white">£499</span>
            <span className="text-xs text-[#8a8f98]">Currys</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[11px] font-semibold ring-1 ring-amber-500/20">
              <Flame className="w-2.5 h-2.5" />
              842°
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-3">
        <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
          <X className="w-4 h-4 text-[#8a8f98]" />
        </div>
        <div className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
          <Bookmark className="w-4 h-4 text-[#8a8f98]" />
        </div>
      </div>
    </motion.div>
  )
}

function SwipeHint({
  direction,
  label,
  sublabel,
  color,
  icon,
}: {
  direction: 'left' | 'right'
  label: string
  sublabel: string
  color: string
  icon: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-2 ${direction === 'left' ? 'flex-row-reverse' : ''}`}>
      <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className={direction === 'left' ? 'text-right' : ''}>
        <p className="text-sm font-semibold text-[#ededef]">{label}</p>
        <p className="text-xs text-[#8a8f98]">{sublabel}</p>
      </div>
    </div>
  )
}

const SEQUENCE = [
  { to: -110, label: 'dismiss' },
  { to: 0, label: 'reset' },
  { to: 110, label: 'save' },
  { to: 0, label: 'reset' },
] as const

export default function SwipeTutorial() {
  const [visible, setVisible] = useState(false)
  const x = useMotionValue(0)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    let cancelled = false
    let step = 0

    async function runLoop() {
      while (!cancelled) {
        const { to } = SEQUENCE[step % SEQUENCE.length]
        await animate(x, to, {
          duration: step % 2 === 0 ? 0.6 : 0.5,
          ease: step % 2 === 0 ? 'easeInOut' : [0.34, 1.56, 0.64, 1],
        })
        await new Promise(r => setTimeout(r, step % 2 === 0 ? 500 : 300))
        step++
      }
    }

    runLoop()
    return () => { cancelled = true }
  }, [visible, x])

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0f]/90 backdrop-blur-sm px-6"
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-sm flex flex-col gap-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-center">
              <p className="text-lg font-semibold text-[#ededef]">Swipe to decide</p>
              <p className="text-sm text-[#8a8f98] mt-1">Review deals without the clutter</p>
            </div>

            <div className="relative">
              <DemoCard x={x} />
            </div>

            <div className="flex justify-between items-start">
              <SwipeHint
                direction="left"
                label="Dismiss"
                sublabel="Never see it again"
                color="bg-red-500/15"
                icon={<X className="w-4 h-4 text-red-400" />}
              />
              <SwipeHint
                direction="right"
                label="Save"
                sublabel="Add to your list"
                color="bg-emerald-500/15"
                icon={<Bookmark className="w-4 h-4 text-emerald-400" />}
              />
            </div>

            <button
              onClick={dismiss}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-sm font-semibold rounded-2xl transition-colors cursor-pointer"
            >
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
