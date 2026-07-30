'use client'

import { useEffect } from 'react'
import { AlertCircle, RotateCcw } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Render error:', error)
  }, [error])

  return (
    <main className="min-h-dvh bg-[#0a0a0f] flex flex-col items-center justify-center px-6">
      <AlertCircle className="w-8 h-8 text-red-400/80" />
      <p className="text-base font-semibold text-[#ededef] mt-3">Something went wrong</p>
      <p className="text-sm text-[#8a8f98] mt-1 text-center max-w-xs">
        The app hit an unexpected error. Try again — your saved deals are safe.
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
    </main>
  )
}
