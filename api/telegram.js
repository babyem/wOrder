/**
 * Vercel webhook — tar emot Telegram-knapptryck
 * Registrera med: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://worder.woso.se/api/telegram
 *
 * Callback-data format:
 *   L:{locationId}              — visa vendors för location
 *   V:{orderId8}:{vendorName}   — visa email/SMS-val för vendor
 *   EM:{orderId8}:{vendorName}  — skicka email till vendor
 *   BACK                        — gå tillbaka (stäng alert)
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN    = process.env.TELEGRAM_TOKEN

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  return res.json()
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

const answerCb  = (id, text = '') => tg('answerCallbackQuery', { callback_query_id: id, text, show_alert: false })
const editMsg   = (chat_id, message_id, text, reply_markup) =>
  tg('editMessageText', { chat_id, message_id, text, parse_mode: 'HTML', reply_markup })

// Hämta orderrader för en vendor + order
async function getVendorItems(orderId, vendorName) {
  const items = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`
  )
  return items.filter(i => i.product?.vendor === vendorName)
}

// Hitta fullständigt order-id från de 8 första tecknen
async function findOrder(orderIdShort) {
  const orders = await db(
    `orders?id=gte.${orderIdShort}&id=lt.${orderIdShort}z&select=id,locations(name)&limit=1`
  )
  return orders[0]
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleLocationPress(locationId, chatId, msgId, cbId) {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const orders = await db(
    `orders?select=id,locations(name)&status=eq.pending&location_id=eq.${locationId}&created_at=gte.${todayStart.toISOString()}&limit=1`
  )
  if (!orders.length) { await answerCb(cbId, 'Inga pending orders för denna location.'); return }

  const order   = orders[0]
  const orderId = order.id
  const items   = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`
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
    text: `📦 ${v}`, callback_data: `V:${orderId.slice(0, 8)}:${v.slice(0, 20)}`,
  }))
  const keyboard = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
  keyboard.push([{ text: '← Tillbaka', callback_data: 'BACK' }])

  await answerCb(cbId)
  await editMsg(chatId, msgId, text, { inline_keyboard: keyboard })
}

async function handleVendorPress(orderIdShort, vendorName, chatId, msgId, cbId) {
  const [vendor, order, vendorItems] = await Promise.all([
    db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email,phone`).then(r => r[0]),
    findOrder(orderIdShort),
    getVendorItems(orderIdShort.padEnd(36, '0'), vendorName), // hämtas igen i EM-steget
  ])

  // Hämta korrekt order och items
  const fullOrder = order
  const items = await getVendorItems(fullOrder?.id, vendorName)
  const itemLines = items.map(i =>
    `• ${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )
  const locationName = fullOrder?.locations?.name || 'Woso Group'

  const text =
    `📦 <b>${vendorName}</b>\n\n` +
    itemLines.map(l => `  ${l}`).join('\n') +
    `\n\nHur vill du notifiera?`

  // Bygg knappar
  const row = []
  if (vendor?.email) {
    row.push({ text: `📧 Email`, callback_data: `EM:${fullOrder.id.slice(0, 8)}:${vendorName.slice(0, 20)}` })
  }
  if (vendor?.phone) {
    // Formatera SMS-body
    const smsBody = encodeURIComponent(
      `Hej ${vendorName},\n\nBeställning från ${locationName}:\n${itemLines.join('\n')}\n\nMvh, Woso Group`
    )
    const phone = vendor.phone.replace(/[\s\-()]/g, '')
    row.push({ text: `📱 SMS`, url: `sms:${phone}?body=${smsBody}` })
  }

  const keyboard = [row, [{ text: '← Tillbaka', callback_data: 'BACK' }]]

  await answerCb(cbId)
  await editMsg(chatId, msgId, text, { inline_keyboard: keyboard })
}

async function handleSendEmail(orderIdShort, vendorName, chatId, msgId, cbId) {
  const order = await findOrder(orderIdShort)
  if (!order) { await answerCb(cbId, 'Order hittades inte.'); return }

  const [vendor, items] = await Promise.all([
    db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email`).then(r => r[0]),
    getVendorItems(order.id, vendorName),
  ])

  if (!vendor?.email) { await answerCb(cbId, 'Ingen email registrerad.'); return }

  const locationName = order.locations?.name || 'Woso Group'
  const itemLines = items.map(i =>
    `• ${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )

  await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({
      to: vendor.email,
      subject: `Beställning från ${locationName}`,
      html: `<h2>Beställning</h2><p>Hej ${vendorName},</p><p>Vi önskar beställa följande:</p><ul>${items.map(i => `<li>${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}</li>`).join('')}</ul><p>Vänliga hälsningar,<br>${locationName}</p>`,
    }),
  })

  await answerCb(cbId, '✅ Email skickat!')
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

  const data  = cb.data
  const chat  = cb.message?.chat?.id
  const msg   = cb.message?.message_id
  const cbId  = cb.id

  try {
    if (data?.startsWith('L:')) {
      await handleLocationPress(data.slice(2), chat, msg, cbId)
    } else if (data?.startsWith('V:')) {
      const [, id, ...v] = data.split(':')
      await handleVendorPress(id, v.join(':'), chat, msg, cbId)
    } else if (data?.startsWith('EM:')) {
      const [, id, ...v] = data.split(':')
      await handleSendEmail(id, v.join(':'), chat, msg, cbId)
    } else if (data === 'BACK') {
      await answerCb(cbId)
    }
  } catch (err) {
    console.error(err)
    await answerCb(cbId, 'Något gick fel, försök igen.')
  }

  res.status(200).end()
}
