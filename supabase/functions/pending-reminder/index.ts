import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Daily reminder: web push to all subscriptions if pending orders exist
serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: pending } = await supabase
      .from('orders')
      .select('id, created_at, location:locations(name)')
      .eq('status', 'pending')

    if (!pending || pending.length === 0) return new Response('no pending', { status: 200 })

    const locations = [...new Set(pending.map(p => (p.location as { name?: string } | null)?.name).filter(Boolean))]
    const oldestMs = Math.min(...pending.map(p => new Date(p.created_at).getTime()))
    const oldestHours = Math.round((Date.now() - oldestMs) / 3_600_000)

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!vapidPublicKey || !vapidPrivateKey) return new Response('no vapid keys', { status: 200 })

    const { data: subscriptions } = await supabase.from('push_subscriptions').select('*')
    if (!subscriptions || subscriptions.length === 0) return new Response('no subscriptions', { status: 200 })

    const webPush = await import('npm:web-push@3.6.7')
    webPush.default.setVapidDetails('mailto:admin@woso.se', vapidPublicKey, vapidPrivateKey)

    const payload = JSON.stringify({
      title: `⏰ ${pending.length} väntande ordrar`,
      body: `${locations.join(', ')}${oldestHours >= 24 ? ` — äldsta har väntat ${oldestHours}h` : ''}`,
    })

    await Promise.allSettled(
      subscriptions.map(sub =>
        webPush.default.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        ).catch(async (err: { statusCode?: number }) => {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        })
      )
    )

    return new Response(`sent for ${pending.length} pending`, { status: 200 })
  } catch (err) {
    return new Response(String(err), { status: 500 })
  }
})
