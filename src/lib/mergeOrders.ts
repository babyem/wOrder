import type { OrderWithDetails } from '../types'

export interface MergedOrderPlan {
  locationId: string
  employeeId: string
  note: string | null
  items: { product_id: string; quantity: number }[]
}

// Räknar ut den sammanslagna ordern: en rad per produkt med summerad kvantitet.
// Anställd tas från en order som hör till målbutiken om det finns en.
export function planMergedOrder(orders: OrderWithDetails[], targetLocationId?: string): MergedOrderPlan {
  if (orders.length === 0) throw new Error('Inga ordrar att slå ihop')
  const locationId = targetLocationId ?? orders[0].location_id
  const base = orders.find(o => o.location_id === locationId) ?? orders[0]

  const merged = new Map<string, number>()
  for (const order of orders) {
    for (const item of order.items) {
      merged.set(item.product_id, (merged.get(item.product_id) ?? 0) + item.quantity)
    }
  }

  const notes = orders.map(o => o.note).filter((n): n is string => !!n)

  return {
    locationId,
    employeeId: base.employee_id,
    note: notes.length ? notes.join(' | ') : null,
    items: [...merged.entries()].map(([product_id, quantity]) => ({ product_id, quantity })),
  }
}

export interface VendorCardMergeUpdate {
  id: string
  vendor_override: string | null
}

// Slår ihop flera leverantörskort inom samma order: alla rader från de valda
// korten flyttas till målleverantören via vendor_override. Rader vars produkt
// redan tillhör målleverantören får null (ingen override behövs).
export function planVendorCardMerge(
  order: OrderWithDetails,
  vendors: string[],
  targetVendor: string,
): VendorCardMergeUpdate[] {
  const sources = new Set(vendors)
  if (!sources.has(targetVendor)) throw new Error('Målleverantören måste vara ett av de valda korten')
  if (sources.size < 2) throw new Error('Välj minst två leverantörskort')

  const updates: VendorCardMergeUpdate[] = []
  for (const item of order.items) {
    const current = item.vendor_override ?? item.product?.vendor ?? '—'
    if (!sources.has(current) || current === targetVendor) continue
    updates.push({
      id: item.id,
      vendor_override: item.product?.vendor === targetVendor ? null : targetVendor,
    })
  }
  return updates
}
