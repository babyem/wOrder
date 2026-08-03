import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Weekly report: emails a summary of the past 7 days' orders
serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: orders } = await supabase
      .from('orders')
      .select('id, created_at, status, location:locations(name), items:order_items(quantity, vendor_override, product:products(name, vendor, unit))')
      .gte('created_at', since)
      .order('created_at')

    if (!orders || orders.length === 0) return new Response('no orders', { status: 200 })

    type Item = { quantity: number; vendor_override: string | null; product: { name: string; vendor: string; unit: string } | null }

    // Per location: order count. Per vendor: product totals.
    const perLocation = new Map<string, number>()
    const perVendor = new Map<string, Map<string, { qty: number; unit: string }>>()

    for (const o of orders) {
      const locName = (o.location as { name?: string } | null)?.name ?? 'Okänd'
      perLocation.set(locName, (perLocation.get(locName) ?? 0) + 1)
      for (const it of (o.items ?? []) as Item[]) {
        const vendor = it.vendor_override ?? it.product?.vendor ?? 'Övrigt'
        const pname = it.product?.name ?? '?'
        const unit = it.product?.unit ?? ''
        if (!perVendor.has(vendor)) perVendor.set(vendor, new Map())
        const m = perVendor.get(vendor)!
        const cur = m.get(pname) ?? { qty: 0, unit }
        cur.qty += it.quantity
        m.set(pname, cur)
      }
    }

    const locLines = [...perLocation.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([loc, n]) => `  ${loc}: ${n} ordrar`)
      .join('\n')

    const vendorBlocks = [...perVendor.entries()]
      .map(([vendor, products]) => {
        const lines = [...products.entries()]
          .sort((a, b) => b[1].qty - a[1].qty)
          .map(([p, { qty, unit }]) => `  ${p}: ${qty} ${unit}`.trimEnd())
          .join('\n')
        return `${vendor}\n${lines}`
      })
      .join('\n\n')

    const text = `Veckorapport — senaste 7 dagarna\n\nTotalt: ${orders.length} ordrar\n\nPer restaurang:\n${locLines}\n\nPer leverantör:\n${vendorBlocks}`

    const apiKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('EMAIL_FROM') ?? 'orders@resend.dev'
    const to = Deno.env.get('EMAIL_REPORT') ?? Deno.env.get('EMAIL_BCC')
    if (!apiKey || !to) return new Response('missing RESEND_API_KEY or EMAIL_REPORT/EMAIL_BCC', { status: 200 })

    const weekStr = new Date().toLocaleDateString('sv-SE')
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: `Veckorapport ordrar — ${weekStr}`, text }),
    })

    if (!res.ok) return new Response(JSON.stringify(await res.json()), { status: res.status })
    return new Response('report sent', { status: 200 })
  } catch (err) {
    return new Response(String(err), { status: 500 })
  }
})
