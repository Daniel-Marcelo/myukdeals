'use client'

import { useRef, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

const THRESHOLD = 72

export default function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>
  children: React.ReactNode
}) {
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const scrollTop = window.scrollY || document.documentElement.scrollTop
    if (scrollTop > 0 || refreshing) return
    startY.current = e.touches[0].clientY
  }, [refreshing])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || refreshing) return
    const delta = e.touches[0].clientY - startY.current
    if (delta <= 0) { startY.current = null; return }
    setPullY(Math.min(delta * 0.45, THRESHOLD + 20))
  }, [refreshing])

  const handleTouchEnd = useCallback(async () => {
    if (startY.current === null) return
    startY.current = null
    if (pullY >= THRESHOLD) {
      setPullY(0)
      setRefreshing(true)
      await onRefresh()
      setRefreshing(false)
    } else {
      setPullY(0)
    }
  }, [pullY, onRefresh])

  const progress = Math.min(pullY / THRESHOLD, 1)

  return (
    <div onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height: refreshing ? THRESHOLD : pullY,
          transition: pullY === 0 ? 'height 0.25s ease' : 'none',
        }}
      >
        <RefreshCw
          className={`w-5 h-5 text-indigo-400 ${refreshing ? 'animate-spin' : ''}`}
          style={{
            opacity: refreshing ? 1 : progress,
            transform: refreshing ? undefined : `rotate(${progress * 240}deg)`,
            transition: pullY === 0 ? 'opacity 0.25s ease' : 'none',
          }}
        />
      </div>
      {children}
    </div>
  )
}
