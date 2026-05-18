/**
 * Vercel webhook — tar emot Telegram-knapptryck
 * Callback-data format (max 64 bytes):
 *   L:{locationId}         — visa vendors för pending order på location
 *   V:{orderId}|{vendor}   — visa email/SMS-val för vendor (| som separator, inte :)
 *   EM:{orderId}|{vendor}  — skicka email
 *   BACK                   — stäng alert
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN    = process.env.TELEGRAM_TOKEN

async function db(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch { throw new Error(`Supabase bad JSON: ${text.slice(0, 200)}`) }
}

async function tg(method, body) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`Telegram bad JSON: ${text.slice(0, 200)}`) }
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description || text}`)
  return json
}

const answerCb = (id, text = '') =>
  tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: !!text })

const editMsg = (chat_id, message_id, text, reply_markup) =>
  tg('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', reply_markup })

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleLocationPress(locationId, chatId, msgId, cbId) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const orders = await db(
    `orders?select=id,locations(name)&status=eq.pending&location_id=eq.${locationId}&created_at=gte.${todayStart.toISOString()}&order=created_at.desc&limit=1`
  )
  if (!orders.length) {
    await answerCb(cbId, 'Inga pending orders för denna location.')
    return
  }

  const order = orders[0]
  const items = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${order.id}`
  )

  const byVendor = {}
  for (const item of items) {
    const v = item.product?.vendor || 'Okänd'
    if (!byVendor[v]) byVendor[v] = []
    byVendor[v].push(`  • ${item.product?.name} — ${item.quantity} ${item.unit_override || item.product?.unit || ''}`)
  }

  let text = `📋 <b>${order.locations?.name}</b>\n\n`
  for (const [v, lines] of Object.entries(byVendor)) {
    text += `<b>${v}:</b>\n${lines.join('\n')}\n\n`
  }
  text += 'Välj leverantör att notifiera:'

  const buttons = Object.keys(byVendor).map(v => ({
    text: `📦 ${v}`,
    callback_data: `V:${order.id}|${v.slice(0, 20)}`,
  }))
  const keyboard = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
  keyboard.push([{ text: '← Tillbaka', callback_data: 'BACK' }])

  await answerCb(cbId)
  await editMsg(chatId, msgId, text, { inline_keyboard: keyboard })
}

async function handleVendorPress(orderId, vendorName, chatId, msgId, cbId) {
  await answerCb(cbId) // Svara Telegram omedelbart — annars timeout

  const [orders, vendorList, allItems] = await Promise.all([
    db(`orders?id=eq.${orderId}&select=id,locations(name)&limit=1`),
    db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email,phone`),
    db(`order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`),
  ])

  const order  = orders[0]
  const vendor = vendorList[0]

  if (!order) { console.error('Order not found:', orderId); return }
  if (!vendor) { console.error('Vendor not found:', vendorName); return }
  if (!vendor.email && !vendor.phone) { console.error('Vendor has no contact:', vendorName); return }

  const vendorItems = allItems.filter(i => i.product?.vendor === vendorName)
  const itemLines = vendorItems.map(i =>
    `• ${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )
  const locationName = order.locations?.name || 'Woso Group'

  const row = []
  if (vendor.email) {
    row.push({ text: `📧 Email — ${vendor.email}`, callback_data: `EM:${orderId}|${vendorName.slice(0, 20)}` })
  }
  if (vendor.phone) {
    const phone = vendor.phone.replace(/[\s \-()+]/g, '')
    const smsBody = encodeURIComponent(
      `Hej ${vendorName}, beställning från ${locationName}:\n${itemLines.join('\n')}\nMvh Woso`
    )
    row.push({ text: `📱 SMS — ${vendor.phone}`, url: `sms:+${phone}?body=${smsBody}` })
  }

  await editMsg(chatId, msgId,
    `📦 <b>${vendorName}</b> — ${locationName}\n\n${itemLines.join('\n')}\n\nHur vill du notifiera?`,
    { inline_keyboard: [row, [{ text: '← Tillbaka', callback_data: 'BACK' }]] }
  )
}

async function handleSendEmail(orderId, vendorName, chatId, msgId, cbId) {
  const [orders, vendorList] = await Promise.all([
    db(`orders?id=eq.${orderId}&select=id,locations(name)&limit=1`),
    db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email`),
  ])

  const order  = orders[0]
  const vendor = vendorList[0]

  if (!vendor?.email) { await answerCb(cbId, 'Ingen email registrerad.'); return }

  const items = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`
  )
  const vendorItems = items.filter(i => i.product?.vendor === vendorName)
  const itemLines = vendorItems.map(i =>
    `• ${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )
  const locationName = order?.locations?.name || 'Woso Group'

  await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({
      to: vendor.email,
      subject: `Beställning från ${locationName}`,
      html: `<h2>Beställning</h2><p>Hej ${vendorName},</p><p>Vi önskar beställa följande:</p><ul>${vendorItems.map(i => `<li>${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}</li>`).join('')}</ul><p>Vänliga hälsningar,<br>${locationName}</p>`,
    }),
  })

  await answerCb(cbId)
  await editMsg(
    chatId, msgId,
    `✅ <b>Email skickat till ${vendorName}</b>\n📧 ${vendor.email}\n\n${itemLines.join('\n')}`,
    { inline_keyboard: [[{ text: '← Tillbaka', callback_data: 'BACK' }]] }
  )
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const cb = req.body?.callback_query
  if (!cb) return res.status(200).end()

  const data = cb.data
  const chat = cb.message?.chat?.id
  const msg  = cb.message?.message_id
  const cbId = cb.id

  console.log(`[telegram] callback: ${data} chat=${chat} msg=${msg}`)
  console.log(`[telegram] env check: SUPABASE_URL=${SUPABASE_URL ? 'set' : 'MISSING'} BOT_TOKEN=${BOT_TOKEN ? 'set' : 'MISSING'}`)

  try {
    if (data?.startsWith('L:')) {
      await handleLocationPress(data.slice(2), chat, msg, cbId)
    } else if (data?.startsWith('V:')) {
      const rest = data.slice(2)
      const sep  = rest.indexOf('|')
      await handleVendorPress(rest.slice(0, sep), rest.slice(sep + 1), chat, msg, cbId)
    } else if (data?.startsWith('EM:')) {
      const rest = data.slice(3)
      const sep  = rest.indexOf('|')
      await handleSendEmail(rest.slice(0, sep), rest.slice(sep + 1), chat, msg, cbId)
    } else if (data === 'BACK') {
      await answerCb(cbId)
    }
  } catch (err) {
    console.error('[telegram] error:', err.message)
    // Try to notify user — may fail if cbId already answered
    try { await answerCb(cbId, '⚠️ Fel: ' + err.message.slice(0, 150)) } catch {}
  }

  res.status(200).end()
}
