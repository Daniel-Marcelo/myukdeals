'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Store } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fetchJson, AuthError } from '@/lib/api'

export default function BlockedMerchantsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const router = useRouter()
  const [blocked, setBlocked] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchJson<{ blocked_merchants: string[] }>('/api/preferences')
      .then(d => {
        if (cancelled) return
        setBlocked(d.blocked_merchants ?? [])
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof AuthError) { router.push('/auth'); return }
        // Without this the list renders as "No retailers blocked yet" for a user
        // who has blocked ten — indistinguishable from real data.
        setError('Could not load your blocked retailers')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [router])

  const save = async (updated: string[], previous: string[]) => {
    setSaving(true)
    try {
      await fetchJson('/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked_merchants: updated }),
      })
      setError(null)
      onChanged()
    } catch (err) {
      if (err instanceof AuthError) { router.push('/auth'); return }
      setBlocked(previous) // undo the optimistic update
      setError('Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  const add = () => {
    const name = input.trim()
    // Case-insensitive: the server stores display casing, so a raw includes()
    // check would let "Amazon" through when "amazon" is already stored.
    const key = name.toLowerCase()
    if (!name || blocked.some(m => m.toLowerCase() === key)) { setInput(''); return }
    const previous = blocked
    const updated = [...blocked, name]
    setBlocked(updated)
    setInput('')
    save(updated, previous)
    inputRef.current?.focus()
  }

  const remove = (merchant: string) => {
    const previous = blocked
    const updated = blocked.filter(m => m !== merchant)
    setBlocked(updated)
    save(updated, previous)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 bottom-4 z-50 bg-[#16161e] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden max-w-sm mx-auto">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-[#8a8f98]" />
            <span className="text-sm font-semibold text-[#ededef]">Blocked retailers</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-white/[0.06] text-[#8a8f98] hover:bg-white/[0.1] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pt-3 pb-2">
          <p className="text-xs text-[#8a8f98] mb-3">Deals from these retailers won&apos;t appear in your feed.</p>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="e.g. Amazon, Argos…"
              className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-[#ededef] placeholder:text-[#8a8f98]/50 outline-none focus:border-indigo-500/50 transition-colors"
            />
            <button
              onClick={add}
              disabled={!input.trim()}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-[#8a8f98]/60 mt-2">
            Matches the retailer and its sub-brands — “Amazon” also blocks “Amazon Warehouse”.
          </p>
        </div>

        <div className="px-4 pb-4 min-h-[48px] max-h-52 overflow-y-auto">
          {error && <p className="text-xs text-red-400 pt-2">{error}</p>}
          {loading ? (
            <div className="flex gap-2 pt-2">
              {[80, 60, 72].map(w => (
                <div key={w} className="h-7 rounded-full shimmer" style={{ width: w }} />
              ))}
            </div>
          ) : blocked.length === 0 && !saving ? (
            <p className="text-xs text-[#8a8f98]/50 pt-2">No retailers blocked yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-2">
              {blocked.map(merchant => (
                <span
                  key={merchant}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] text-xs text-[#ededef] border border-white/[0.06]"
                >
                  {merchant}
                  <button
                    onClick={() => remove(merchant)}
                    className="text-[#8a8f98] hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  )
}
