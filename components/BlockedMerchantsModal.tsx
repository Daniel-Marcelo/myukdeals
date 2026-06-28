'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Store } from 'lucide-react'

export default function BlockedMerchantsModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [blocked, setBlocked] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.json())
      .then(d => { setBlocked(d.blocked_merchants ?? []); setLoading(false) })
  }, [])

  const save = async (updated: string[]) => {
    setSaving(true)
    await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocked_merchants: updated }),
    })
    setSaving(false)
    onChanged()
  }

  const add = () => {
    const name = input.trim()
    if (!name || blocked.includes(name)) { setInput(''); return }
    const updated = [...blocked, name]
    setBlocked(updated)
    setInput('')
    save(updated)
    inputRef.current?.focus()
  }

  const remove = (merchant: string) => {
    const updated = blocked.filter(m => m !== merchant)
    setBlocked(updated)
    save(updated)
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
          <p className="text-xs text-[#8a8f98] mb-3">Deals from these retailers won't appear in your feed.</p>
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
        </div>

        <div className="px-4 pb-4 min-h-[48px] max-h-52 overflow-y-auto">
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
