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

    const [{ data: employee }, { data: location }, { data: items }] = await Promise.all([
      supabase.from('employees').select('name').eq('id', record.employee_id).single(),
      supabase.from('locations').select('name').eq('id', record.location_id).single(),
      supabase.from('order_items').select('quantity').eq('order_id', record.id),
    ])

    const employeeName = employee?.name ?? 'Unknown'
    const locationName = location?.name ?? 'Unknown'
    const totalItems = (items ?? []).reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0)
    const note = record.note ? `\n📝 ${record.note}` : ''

    const ntfyTopic = Deno.env.get('NTFY_TOPIC') ?? 'new_order_notification'
    const ntfyUrl = `https://ntfy.sh/${ntfyTopic}`

    await fetch(ntfyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Order',
        message: `${employeeName} · ${locationName}\n${totalItems} item${totalItems !== 1 ? 's' : ''}${note}`,
        priority: 4,
        tags: ['shopping'],
      }),
    })

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response(String(err), { status: 500 })
  }
})
