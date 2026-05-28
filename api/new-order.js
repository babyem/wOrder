/**
 * Vercel webhook — triggas av Supabase Database Webhook vid ny order (INSERT)
 *
 * Supabase-inställningar:
 *   Table: orders | Event: INSERT
 *   URL: https://worder.woso.se/api/new-order
 *   HTTP Headers: { "x-webhook-secret": "<WEBHOOK_SECRET>" }
 */

import webpush from 'web-push'

const SUPABASE_URL     = process.env.SUPABASE_URL
const SUPABASE_KEY     = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN        = process.env.TELEGRAM_TOKEN
const CHAT_ID          = process.env.TELEGRAM_CHAT_ID
const WEBHOOK_SECRET   = process.env.WEBHOOK_SECRET
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  return res.json()
}

async function sendTelegram(text, reply_markup) {
  const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML' }
  if (reply_markup) body.reply_markup = reply_markup
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function sendWebPush(payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('[push] VAPID keys missing, skipping')
    return
  }

  const subscriptions = await db('push_subscriptions?select=endpoint,p256dh,auth')
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    console.log('[push] no subscriptions found')
    return
  }

  console.log(`[push] sending to ${subscriptions.length} subscription(s)`)
  webpush.setVapidDetails('mailto:admin@woso.se', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        const r = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
        console.log(`[push] ok statusCode=${r.statusCode}`)
      } catch (err) {
        console.error(`[push] failed statusCode=${err.statusCode} msg=${err.message}`)
        if (err.statusCode === 410 || err.statusCode === 404) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`,
            { method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
          )
        }
      }
    })
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).end()
  }

  const record = req.body?.record
  if (!record?.id) return res.status(200).end()

  try {
    const orderId = record.id

    const [orders, items] = await Promise.all([
      db(`orders?id=eq.${orderId}&select=id,created_at,locations(name),employees(name)&limit=1`),
      db(`order_items?order_id=eq.${orderId}&select=quantity,unit_override,product:products(name,unit,vendor)`),
    ])

    const order = orders[0]
    if (!order) return res.status(200).end()

    const locationName = order.locations?.name || 'Okänd location'
    const employeeName = order.employees?.name || 'Okänd'
    const time = new Date(order.created_at).toLocaleTimeString('sv-SE', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm',
    })

    // Gruppera items per leverantör
    const byVendor = {}
    for (const item of items) {
      const v = item.product?.vendor || 'Okänd'
      if (!byVendor[v]) byVendor[v] = []
      byVendor[v].push(`  • ${item.product?.name} — ${item.quantity} ${item.unit_override || item.product?.unit || ''}`)
    }

    // Bygg meddelande
    let text = `🆕 <b>Ny order — ${locationName}</b>\n`
    text += `👤 ${employeeName} · kl ${time}\n\n`
    for (const [v, lines] of Object.entries(byVendor)) {
      text += `<b>${v}:</b>\n${lines.join('\n')}\n\n`
    }
    text += 'Tryck för att notifiera leverantör:'

    // Knappar per leverantör
    const vendorNames = Object.keys(byVendor)
    const buttons = vendorNames.map(v => ({
      text: `📦 ${v}`,
      callback_data: `V:${orderId}|${v.slice(0, 20)}`,
    }))
    const keyboard = []
    for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
    keyboard.push([{ text: '🔗 Öppna Staff Orders', url: 'https://worder.woso.se/admin/orders' }])

    // Bygg push-body med leverantörer + produkter
    const vendorSummary = Object.entries(byVendor)
      .map(([v, lines]) => {
        const items = lines.map(l => l.replace(/^\s+•\s+/, '').replace(/\s+—\s+/, ' ').trim()).join(', ')
        return `${v}: ${items}`
      })
      .join('\n')

    // Skicka Telegram + web push parallellt
    const pushPayload = {
      title: `Ny order 🛒 — ${locationName}`,
      body: `${employeeName} · kl ${time}\n\n${vendorSummary}`,
      orderId,
    }

    await Promise.all([
      sendTelegram(text, { inline_keyboard: keyboard }),
      sendWebPush(pushPayload),
    ])

    return res.status(200).end()
  } catch (err) {
    console.error('new-order webhook error:', err)
    return res.status(500).json({ error: err.message })
  }
}
