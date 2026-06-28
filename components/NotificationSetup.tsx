'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff } from 'lucide-react'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

type Status = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading'

export default function NotificationSetup() {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('denied')
      return
    }
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setStatus(sub ? 'subscribed' : 'unsubscribed')
    })
  }, [])

  const subscribe = async () => {
    setStatus('loading')
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
      ),
    })
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    })
    setStatus('subscribed')
  }

  const unsubscribe = async () => {
    setStatus('loading')
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
      await sub.unsubscribe()
    }
    setStatus('unsubscribed')
  }

  const handleClick = async () => {
    if (status === 'unsubscribed') {
      if (Notification.permission === 'default') {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') { setStatus('denied'); return }
      }
      await subscribe()
    } else if (status === 'subscribed') {
      await unsubscribe()
    }
  }

  if (status === 'unsupported' || status === 'denied') return null
  if (status === 'loading') return <div className="w-8 h-8" />

  return (
    <button
      onClick={handleClick}
      title={status === 'subscribed' ? 'Disable deal alerts' : 'Enable deal alerts'}
      className={`w-8 h-8 flex items-center justify-center rounded-full transition-all cursor-pointer ${
        status === 'subscribed'
          ? 'bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30'
          : 'bg-white/[0.06] text-[#8a8f98] hover:bg-white/[0.1] hover:text-white'
      }`}
    >
      {status === 'subscribed' ? (
        <Bell className="w-3.5 h-3.5" />
      ) : (
        <BellOff className="w-3.5 h-3.5" />
      )}
    </button>
  )
}
