#!/usr/bin/env node
/**
 * Order Reminder — körs av GitHub Actions
 * Skickar Telegram-notis med knappar per location om det finns pending orders.
 */

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN     = process.env.TELEGRAM_TOKEN
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID
const DEADLINE      = process.env.DEADLINE || '21:30'

async function supabase(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sendTelegram(text, reply_markup) {
  const body = { chat_id: CHAT_ID, text, parse_mode: 'HTML' }
  if (reply_markup) body.reply_markup = reply_markup
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`)
}

;(async () => {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Hämta pending orders med location
  const orders = await supabase(
    `orders?select=id,status,created_at,location:locations(id,name)&status=eq.pending&created_at=gte.${todayStart.toISOString()}&order=created_at.asc`
  )

  if (orders.length === 0) {
    console.log('Inga pending orders idag.')
    return
  }

  const now = new Date().toLocaleTimeString('sv-SE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm',
  })

  // Bygg knappar per location (en knapp per unik location)
  const seen = new Set()
  const buttons = []
  for (const o of orders) {
    const locId = o.location?.id
    const locName = o.location?.name
    if (locId && !seen.has(locId)) {
      seen.add(locId)
      buttons.push({ text: `📋 ${locName}`, callback_data: `L:${locId}` })
    }
  }

  // Dela upp i rader om 2 knappar
  const keyboard = []
  for (let i = 0; i < buttons.length; i += 2) {
    keyboard.push(buttons.slice(i, i + 2))
  }
  keyboard.push([{ text: '🔗 Öppna Staff Orders', url: 'https://worder.woso.se/admin/orders' }])

  const locationList = [...seen].map(id => {
    const o = orders.find(x => x.location?.id === id)
    return `  • ${o.location?.name}`
  }).join('\n')

  await sendTelegram(
    `⚠️ <b>${orders.length} pending order${orders.length > 1 ? 's' : ''}</b> — deadline <b>${DEADLINE}</b>\n\n` +
    `${locationList}\n\n` +
    `🕐 Klockan är nu ${now}\n` +
    `Tryck på en location för att notifiera leverantör:`,
    { inline_keyboard: keyboard }
  )

  console.log(`✓ Skickade notis för ${orders.length} order(s) på ${[...seen].size} location(s)`)
})().catch(err => { console.error('Fel:', err.message); process.exit(1) })
