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
      supabase.from('order_items')
        .select('quantity, products(name, vendor)')
        .eq('order_id', record.id),
    ])

    const employeeName = employee?.name ?? 'Unknown'
    const locationName = location?.name ?? 'Unknown'

    // Group items by vendor
    const byVendor = new Map<string, { name: string; quantity: number }[]>()
    for (const item of items ?? []) {
      const product = (item as Record<string, unknown>).products as { name: string; vendor: string } | null
      const vendor = product?.vendor || 'Övrigt'
      const name = product?.name ?? '?'
      const existing = byVendor.get(vendor) ?? []
      existing.push({ name, quantity: item.quantity })
      byVendor.set(vendor, existing)
    }

    const vendorLines = [...byVendor.entries()]
      .map(([vendor, products]) => {
        const lines = products.map(p => `${p.name} x${p.quantity}`).join('\n')
        return `${vendor}\n${lines}`
      })
      .join('\n\n')

    const note = record.note ? `\n\n📝 ${record.note}` : ''
    const message = `${locationName} · ${employeeName}\n\n${vendorLines}${note}`

    const ntfyTopic = Deno.env.get('NTFY_TOPIC') ?? 'new_order_notification'

    await fetch(`https://ntfy.sh/${ntfyTopic}`, {
      method: 'POST',
      headers: {
        'Title': 'New Order 🛒',
        'Priority': '4',
        'Tags': 'shopping',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: message,
    })

    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error(err)
    return new Response(String(err), { status: 500 })
  }
})
