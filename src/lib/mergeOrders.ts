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
