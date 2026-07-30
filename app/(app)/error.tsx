'use client'

import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

/**
 * Feed-level boundary. Sits INSIDE the (app) layout, so a crash in a feed keeps
 * the header and bottom tab bar on screen and the user can switch tabs out of
 * the broken one — much better than losing the whole shell to app/error.tsx.
 */
export default function FeedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Feed render error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-28 px-6">
      <AlertCircle className="w-8 h-8 text-red-400/80" />
      <p className="text-base font-semibold text-[#ededef] mt-3">This feed crashed</p>
      <p className="text-sm text-[#8a8f98] mt-1 text-center max-w-xs">
        Try again, or switch to another tab.
      </p>
      <button
        onClick={reset}
        className="mt-6 flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Try again
      </button>
      {error.digest && (
        <p className="text-[11px] text-[#8a8f98]/40 mt-6 font-mono">{error.digest}</p>
      )}
    </div>
  )
}
