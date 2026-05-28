import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const payload = await req.json()
    const record = payload?.record
    if (!record) return new Response('no record', { status: 400 })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Wait for order_items to be inserted (they come in a second query after orders)
    await new Promise(r => setTimeout(r, 3000))

    const [{ data: employee }, { data: location }, { data: items }] = await Promise.all([
      supabase.from('employees').select('name').eq('id', record.employee_id).single(),
      supabase.from('locations').select('name').eq('id', record.location_id).single(),
      supabase.from('order_items')
        .select('quantity, products(name, vendor, unit)')
        .eq('order_id', record.id),
    ])

    const employeeName = employee?.name ?? 'Unknown'
    const locationName = location?.name ?? 'Unknown'

    // Group items by vendor
    const byVendor = new Map<string, { name: string; quantity: number; unit: string }[]>()
    for (const item of items ?? []) {
      const product = (item as Record<string, unknown>).products as { name: string; vendor: string; unit: string } | null
      const vendor = product?.vendor || 'Övrigt'
      const name = product?.name ?? '?'
      const unit = product?.unit ?? ''
      const existing = byVendor.get(vendor) ?? []
      existing.push({ name, quantity: item.quantity, unit })
      byVendor.set(vendor, existing)
    }

    const vendorLines = [...byVendor.entries()]
      .map(([vendor, products]) => {
        const lines = products.map(p => `${p.name} ${p.quantity} ${p.unit}`.trim()).join('\n')
        return `**${vendor}**\n${lines}`
      })
      .join('\n\n')

    const note = record.note ? `\n\n📝 ${record.note}` : ''
    const message = `${locationName} · ${employeeName}\n\n${vendorLines}${note}`

    const ntfyTopic = Deno.env.get('NTFY_TOPIC') ?? 'new_order_notification'

    // POST to ntfy root URL with JSON body (topic in payload) — reliable across all runtimes
    await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: ntfyTopic,
        title: 'New Order 🛒',
        message,
        markdown: true,
        priority: 4,
        tags: ['shopping'],
      }),
    })

    // --- Web Push ---
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    const pushReport: Record<string, unknown> = {}

    if (!vapidPublicKey || !vapidPrivateKey) {
      pushReport.skipped = `VAPID env missing (public=${!!vapidPublicKey}, private=${!!vapidPrivateKey})`
      console.error('[notify-order]', pushReport.skipped)
    } else {
      const { data: subscriptions, error: subErr } = await supabase.from('push_subscriptions').select('*')

      if (subErr) {
        pushReport.subscriptionQueryError = subErr.message
        console.error('[notify-order] subscription query failed:', subErr)
      } else if (!subscriptions || subscriptions.length === 0) {
        pushReport.subscriptions = 0
        console.warn('[notify-order] no push subscriptions found in DB')
      } else {
        pushReport.subscriptions = subscriptions.length
        console.log(`[notify-order] sending push to ${subscriptions.length} subscription(s)`)

        const webPush = await import('npm:web-push@3.6.7')
        webPush.default.setVapidDetails(
          'mailto:admin@woso.se',
          vapidPublicKey,
          vapidPrivateKey
        )

        const pushPayload = JSON.stringify({
          title: 'New Order 🛒',
          body: `${locationName} · ${employeeName}\n${message.split('\n\n').slice(1).join('\n')}`.trim(),
          orderId: record.id,
        })

        const results = await Promise.allSettled(
          subscriptions.map(async sub => {
            try {
              const r = await webPush.default.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                pushPayload
              )
              console.log(`[notify-order] push ok statusCode=${r.statusCode} endpoint=${sub.endpoint.slice(0, 60)}...`)
              return { ok: true, statusCode: r.statusCode }
            } catch (err) {
              const e = err as { statusCode?: number; body?: string; message?: string }
              console.error(`[notify-order] push FAILED statusCode=${e.statusCode} body=${e.body} msg=${e.message} endpoint=${sub.endpoint.slice(0, 60)}...`)
              if (e.statusCode === 410 || e.statusCode === 404) {
                await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
              }
              return { ok: false, statusCode: e.statusCode, body: e.body, message: e.message }
            }
          })
        )

        pushReport.results = results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, rejected: true })
      }
    }

    return new Response(JSON.stringify({ ok: true, push: pushReport }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(String(err), { status: 500 })
  }
})
