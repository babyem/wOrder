/**
 * Vercel webhook — triggas av Supabase Database Webhook vid ny order (INSERT)
 *
 * Supabase-inställningar:
 *   Table: orders | Event: INSERT
 *   URL: https://worder.woso.se/api/new-order
 *   HTTP Headers: { "x-webhook-secret": "<WEBHOOK_SECRET>" }
 */

const SUPABASE_URL    = process.env.SUPABASE_URL
const SUPABASE_KEY    = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN       = process.env.TELEGRAM_TOKEN
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET  // valfri säkerhetskontroll

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verifiera secret om satt
  if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
    return res.status(401).end()
  }

  const record = req.body?.record
  if (!record?.id) return res.status(200).end()

  try {
    const orderId = record.id

    // Hämta order med location och employee
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
      callback_data: `V:${orderId.slice(0, 8)}:${v.slice(0, 20)}`,
    }))
    const keyboard = []
    for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
    keyboard.push([{ text: '🔗 Öppna Staff Orders', url: 'https://worder.woso.se/admin/orders' }])

    await sendTelegram(text, { inline_keyboard: keyboard })
    return res.status(200).end()
  } catch (err) {
    console.error('new-order webhook error:', err)
    return res.status(500).json({ error: err.message })
  }
}
