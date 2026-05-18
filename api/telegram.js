/**
 * Vercel webhook — tar emot Telegram-knapptryck
 * Registrera med: https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://worder.woso.se/api/telegram
 */

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY
const BOT_TOKEN     = process.env.TELEGRAM_TOKEN

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  return res.json()
}

async function answerCallback(callback_query_id, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id, text, show_alert: false }),
  })
}

async function editMessage(chat_id, message_id, text, reply_markup) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, text, parse_mode: 'HTML', reply_markup }),
  })
}

async function handleLocationPress(locationId, chatId, messageId, callbackId) {
  // Hämta pending order för denna location idag
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const orders = await db(
    `orders?select=id,location:locations(name)&status=eq.pending&location_id=eq.${locationId}&created_at=gte.${todayStart.toISOString()}&limit=1`
  )
  if (!orders.length) {
    await answerCallback(callbackId, 'Inga pending orders för denna location.')
    return
  }
  const order = orders[0]
  const orderId = order.id

  // Hämta orderrader med produktinfo och leverantör
  const items = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${orderId}`
  )

  // Gruppera per leverantör
  const byVendor = {}
  for (const item of items) {
    const vendor = item.product?.vendor || 'Okänd leverantör'
    if (!byVendor[vendor]) byVendor[vendor] = []
    const unit = item.unit_override || item.product?.unit || ''
    byVendor[vendor].push(`  • ${item.product?.name} — ${item.quantity} ${unit}`)
  }

  // Bygg meddelande
  let text = `📋 <b>${order.location?.name}</b>\n\n`
  for (const [vendor, lines] of Object.entries(byVendor)) {
    text += `<b>${vendor}:</b>\n${lines.join('\n')}\n\n`
  }
  text += 'Välj leverantör att notifiera:'

  // Knappar per leverantör
  const vendorNames = Object.keys(byVendor)
  const buttons = vendorNames.map(v => ({
    text: `📧 ${v}`,
    callback_data: `V:${orderId.slice(0, 8)}:${v.slice(0, 20)}`,
  }))
  const keyboard = []
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2))
  keyboard.push([{ text: '← Tillbaka', callback_data: 'BACK' }])

  await answerCallback(callbackId, '')
  await editMessage(chatId, messageId, text, { inline_keyboard: keyboard })
}

async function handleVendorPress(orderIdShort, vendorName, chatId, messageId, callbackId) {
  // Hitta leverantörens kontaktinfo
  const vendors = await db(`vendors?name=eq.${encodeURIComponent(vendorName)}&select=name,email,phone`)
  const vendor = vendors[0]

  if (!vendor) {
    await answerCallback(callbackId, `Hittar inte ${vendorName} i systemet.`)
    return
  }

  if (!vendor.email && !vendor.phone) {
    await answerCallback(callbackId, `${vendorName} har varken email eller telefon registrerat.`)
    return
  }

  // Hämta orderrader för denna leverantör
  const orders = await db(`orders?id=like.${orderIdShort}*&select=id,location:locations(name)&limit=1`)
  const order = orders[0]
  const items = await db(
    `order_items?select=quantity,unit_override,product:products(name,unit,vendor)&order_id=eq.${order?.id}`
  )
  const vendorItems = items.filter(i => i.product?.vendor === vendorName)
  const itemLines = vendorItems.map(i => `• ${i.product?.name} — ${i.quantity} ${i.unit_override || i.product?.unit || ''}`).join('\n')

  // Skicka email via Supabase Edge Function
  if (vendor.email) {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        to: vendor.email,
        subject: `Beställning från ${order?.location?.name || 'Staff Orders'}`,
        html: `<h2>Beställning</h2><p>Hej ${vendorName},</p><p>Vi önskar beställa följande:</p><pre>${itemLines}</pre><p>Vänliga hälsningar,<br>Woso Group</p>`,
      }),
    })
  }

  await answerCallback(callbackId, `✅ Notis skickad till ${vendorName}!`)
  await editMessage(
    chatId, messageId,
    `✅ <b>Notis skickad till ${vendorName}</b>\n\n${vendor.email ? `📧 ${vendor.email}` : `📱 ${vendor.phone}`}\n\n${itemLines}`,
    { inline_keyboard: [[{ text: '← Tillbaka', callback_data: 'BACK' }]] }
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const body = req.body
  const cb = body?.callback_query
  if (!cb) return res.status(200).end()

  const data    = cb.data
  const chatId  = cb.message?.chat?.id
  const msgId   = cb.message?.message_id
  const cbId    = cb.id

  try {
    if (data?.startsWith('L:')) {
      await handleLocationPress(data.slice(2), chatId, msgId, cbId)
    } else if (data?.startsWith('V:')) {
      const [, orderIdShort, ...vendorParts] = data.split(':')
      await handleVendorPress(orderIdShort, vendorParts.join(':'), chatId, msgId, cbId)
    } else if (data === 'BACK') {
      await answerCallback(cbId, '')
    }
  } catch (err) {
    console.error(err)
    await answerCallback(cbId, 'Något gick fel, försök igen.')
  }

  res.status(200).end()
}
