self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body, url, icon } = event.data.json()
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: icon || '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
      tag: 'hotdeal',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const match = wins.find((w) => w.url === url && 'focus' in w)
      if (match) return match.focus()
      return clients.openWindow(url)
    })
  )
})
