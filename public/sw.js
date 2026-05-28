const SUPABASE_URL = 'https://cjrzeoswkzenwlftsahp.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNqcnplb3N3a3plbndsZnRzYWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjkwMTIsImV4cCI6MjA5NDM0NTAxMn0.KHMSRNjvuzlCny3ciDJj2CtJTOeXKLk3u3HAijlLAEg'

self.addEventListener('push', event => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'New Order 🛒', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      data: { orderId: data.orderId, url: '/admin/orders' },
      actions: [
        { action: 'open', title: '📦 Öppna order' },
        { action: 'done', title: '✅ Markera klar' },
      ],
      requireInteraction: true,
      tag: `order-${data.orderId}`,
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const orderId = event.notification.data?.orderId

  if (event.action === 'done' && orderId) {
    event.waitUntil(
      fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ status: 'done', completed_at: new Date().toISOString() }),
      })
    )
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
        for (const client of clientList) {
          if (client.url.includes('/admin') && 'focus' in client) {
            return client.focus()
          }
        }
        return clients.openWindow(self.registration.scope + 'admin/orders')
      })
    )
  }
})
