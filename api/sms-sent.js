/**
 * Vercel endpoint — anropas av genvägen "wOrder SMS" (Genvägar på iPhone/Mac)
 * direkt efter att SMS:et skickats.
 *
 *   POST /api/sms-sent   { "id": "<order_send_log.id>" }
 *
 * Appen har redan skrivit raden som 'pending' när SMS-knappen trycktes; här
 * flippas den till 'sent' via confirm_sms_sent() (migration 039). Appen pollar
 * raden och markerar leverantören klar när den ser 'sent'.
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Genvägar skickar JSON, men tål även en rå sträng
  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const id = String(body?.id ?? '').trim()
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' })

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_sms_sent`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_id: id }),
  })
  if (!r.ok) {
    console.error('[sms-sent] rpc failed', r.status, await r.text())
    return res.status(502).json({ error: 'Database error' })
  }

  const confirmed = await r.json()
  if (!confirmed) return res.status(404).json({ error: 'No pending SMS with that id' })
  return res.status(200).json({ ok: true })
}
