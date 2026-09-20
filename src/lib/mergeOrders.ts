import type { OrderWithDetails } from '../types'

export interface MergedOrderPlan {
  locationId: string
  employeeId: string
  note: string | null
  items: MergedOrderItem[]
}

export interface MergedOrderItem {
  product_id: string
  quantity: number
  vendor_override: string | null
  unit_override: string | null
  notify_excluded: boolean
}

// Räknar ut den sammanslagna ordern: en rad per produkt med summerad kvantitet.
// Rader med olika leverantör/enhet/struken-status hålls isär så att admins
// ändringar (bytt leverantör, struken rad) följer med in i den nya ordern.
// Anställd tas från en order som hör till målbutiken om det finns en.
export function planMergedOrder(orders: OrderWithDetails[], targetLocationId?: string): MergedOrderPlan {
  if (orders.length === 0) throw new Error('Inga ordrar att slå ihop')
  const locationId = targetLocationId ?? orders[0].location_id
  const base = orders.find(o => o.location_id === locationId) ?? orders[0]

  const merged = new Map<string, MergedOrderItem>()
  for (const order of orders) {
    for (const item of order.items) {
      const vendor_override = item.vendor_override ?? null
      const unit_override = item.unit_override ?? null
      const notify_excluded = !!item.notify_excluded
      const key = JSON.stringify([item.product_id, vendor_override, unit_override, notify_excluded])
      const existing = merged.get(key)
      if (existing) existing.quantity += item.quantity
      else merged.set(key, { product_id: item.product_id, quantity: item.quantity, vendor_override, unit_override, notify_excluded })
    }
  }

  const notes = orders.map(o => o.note).filter((n): n is string => !!n)

  return {
    locationId,
    employeeId: base.employee_id,
    note: notes.length ? notes.join(' | ') : null,
    items: [...merged.values()],
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
