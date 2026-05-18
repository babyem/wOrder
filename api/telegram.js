/**
 * Vercel webhook -- tar emot Telegram-knapptryck
 * Callback-data format (max 64 bytes):
 *   L:{locationId}        -- visa vendors for pending order pa location
 *   V:{orderId}|{vendor}  -- visa kontaktval for vendor
 *   EM:{orderId}|{vendor} -- skicka email + markera order klar
 *   DONE:{orderId}        -- markera order som klar (efter SMS)
 *   BACK:{orderId}        -- ga tillbaka till leverantorslistan for ordern
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN    = process.env.TELEGRAM_TOKEN

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${text}`)
  try { return JSON.parse(text) } catch { throw new Error(`Supabase bad JSON: ${text.slice(0, 200)}`) }
}

async function dbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase PATCH error ${res.status}: ${text}`)
  }
}

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
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

// Builds and shows the vendor list for an order (used by handleLocationPress and handleBack)
async function showVendorList(orderId, locationName, chatId, msgId, headerText) {
  const [orders, items] = await Promise.all([
    orderId ? Promise.resolve(null) : Promise.resolve(null),
    db(`order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`),
  ])

  const byVendor = {}
  for (const item of items) {
    const v = item.product?.vendor || 'Okand'
    if (!byVendor[v]) byVendor[v] = []
    byVendor[v].push(`- ${item.product?.name} - ${item.quantity} ${item.unit_override || item.product?.unit || ''}`)
  }

  let text = `<b>${locationName}</b>\n\n`
  for (const [v, lines] of Object.entries(byVendor)) {
    text += `<b>${v}:</b>\n${lines.join('\n')}\n\n`
  }
  if (headerText) text += headerText + '\n\n'
  text += 'Valj leverantor att notifiera:'

  const buttons = Object.keys(byVendor).map(v => ({
    text: `[${v}]`,
    callback_data: `V:${orderId}|${v.slice(0, 20)}`,
  }))
  const keyboard = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))

  await editMsg(chatId, msgId, text, { inline_keyboard: keyboard })
}

// Handlers

async function handleLocationPress(locationId, chatId, msgId, cbId) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const orders = await db(
    `orders?select=id,locations(name)&status=eq.pending&location_id=eq.${locationId}` +
    `&created_at=gte.${todayStart.toISOString()}&order=created_at.desc&limit=1`
  )
  if (!orders.length) {
    await answerCb(cbId, 'Inga pending orders for denna location.')
    return
  }

  const order = orders[0]
  await answerCb(cbId)
  await showVendorList(order.id, order.locations?.name || locationId, chatId, msgId, null)
}

async function handleVendorPress(orderId, vendorName, chatId, msgId, cbId) {
  await answerCb(cbId) // Must be first -- Telegram times out after ~3s

  const [orders, vendorList, allItems] = await Promise.all([
    db(`orders?id=eq.${orderId}&select=id,locations(name)&limit=1`),
    db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email,phone`),
    db(`order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`),
  ])

  const order  = orders[0]
  const vendor = vendorList[0]

  if (!order)  { console.error('Order not found:', orderId);     return }
  if (!vendor) { console.error('Vendor not found:', vendorName); return }
  if (!vendor.email && !vendor.phone) {
    console.error('Vendor has no contact info:', vendorName)
    return
  }

  const vendorItems = allItems.filter(i => i.product?.vendor === vendorName)
  const itemLines   = vendorItems.map(i =>
    `- ${i.product?.name} - ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )
  const locationName = order.locations?.name || 'Woso Group'

  const msgText = `<b>${vendorName}</b> - ${locationName}\n\n${itemLines.join('\n')}\n\nHur vill du notifiera?`

  const row = []
  if (vendor.email) {
    row.push({ text: 'Skicka email', callback_data: `EM:${orderId}|${vendorName.slice(0, 20)}` })
  }
  if (vendor.phone) {
    const phone = vendor.phone.replace(/[\s\-()+ ]/g, '')
    const smsBody = `Hej ${vendorName}, bestallning fran ${locationName}:\n${itemLines.join('\n')}\nMvh Woso`
    // /sms.html redirects https -> sms: scheme (Telegram blocks sms:/tel: in button URLs)
    const redirectUrl = `https://worder.woso.se/sms.html?to=%2B${phone}&body=${encodeURIComponent(smsBody)}`
    row.push({ text: `SMS till ${vendor.phone}`, url: redirectUrl })
  }

  const keyboard = []
  if (row.length) keyboard.push(row)
  keyboard.push([{ text: 'Bekreft SMS skickat', callback_data: `DONE:${orderId}` }])
  keyboard.push([{ text: '<- Tillbaka', callback_data: `BACK:${orderId}` }])

  await editMsg(chatId, msgId, msgText, { inline_keyboard: keyboard })
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
  const itemLines   = vendorItems.map(i =>
    `- ${i.product?.name} - ${i.quantity} ${i.unit_override || i.product?.unit || ''}`
  )
  const locationName = order?.locations?.name || 'Woso Group'

  const plainText = `Hej ${vendorName},\n\nVi onskar bestalla foljande:\n${itemLines.join('\n')}\n\nVanliga halsningar,\n${locationName}`
  const htmlBody  = `<h2>Bestallning</h2><p>Hej ${vendorName},</p><p>Vi onskar bestalla foljande:</p><ul>` +
    vendorItems.map(i =>
      `<li>${i.product?.name} - ${i.quantity} ${i.unit_override || i.product?.unit || ''}</li>`
    ).join('') +
    `</ul><p>Vanliga halsningar,<br>${locationName}</p>`

  const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ to: vendor.email, subject: `Bestallning fran ${locationName}`, text: plainText, html: htmlBody }),
  })
  const emailResult = await emailRes.json()
  if (!emailRes.ok) throw new Error(`Email failed: ${JSON.stringify(emailResult)}`)

  await answerCb(cbId)

  // Go back to vendor list so user can notify remaining vendors, with a success note
  await showVendorList(orderId, locationName, chatId, msgId, `Email skickat till ${vendorName} (${vendor.email})`)
}

async function handleDone(orderId, chatId, msgId, cbId) {
  await answerCb(cbId)
  await dbPatch(`orders?id=eq.${orderId}`, { status: 'done' })

  // Fetch location name for the header
  const orders = await db(`orders?id=eq.${orderId}&select=locations(name)&limit=1`)
  const locationName = orders[0]?.locations?.name || 'Woso Group'

  // Return to vendor list so user can notify remaining vendors
  await showVendorList(orderId, locationName, chatId, msgId, 'Order markerad som klar.')
}

async function handleBack(orderId, chatId, msgId, cbId) {
  await answerCb(cbId)
  const orders = await db(`orders?id=eq.${orderId}&select=locations(name)&limit=1`)
  const locationName = orders[0]?.locations?.name || 'Order'
  await showVendorList(orderId, locationName, chatId, msgId, null)
}

// Main handler

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const cb = req.body?.callback_query
  if (!cb) return res.status(200).end()

  const data = cb.data
  const chat = cb.message?.chat?.id
  const msg  = cb.message?.message_id
  const cbId = cb.id

  console.log(`[telegram] callback: ${data} chat=${chat} msg=${msg}`)

  if (!SUPABASE_URL || !SUPABASE_KEY || !BOT_TOKEN) {
    const missing = [
      !SUPABASE_URL && 'SUPABASE_URL',
      !SUPABASE_KEY && 'SUPABASE_ANON_KEY',
      !BOT_TOKEN    && 'TELEGRAM_TOKEN',
    ].filter(Boolean).join(', ')
    console.error('[telegram] Missing env vars:', missing)
    try { await answerCb(cbId, `Saknar env vars: ${missing}`) } catch {}
    return res.status(200).end()
  }

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
    } else if (data?.startsWith('DONE:')) {
      await handleDone(data.slice(5), chat, msg, cbId)
    } else if (data?.startsWith('BACK:')) {
      await handleBack(data.slice(5), chat, msg, cbId)
    } else if (data === 'BACK') {
      await answerCb(cbId)
    }
  } catch (err) {
    console.error('[telegram] error:', err.message)
    try {
      await editMsg(chat, msg,
        `<b>Fel:</b> ${err.message.slice(0, 300)}`,
        { inline_keyboard: [[{ text: 'Stang', callback_data: 'BACK' }]] }
      )
    } catch {
      try { await answerCb(cbId, 'Fel, kolla Vercel-loggar') } catch {}
    }
  }

  res.status(200).end()
}
