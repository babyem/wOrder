import type { OrderWithDetails } from '../types'

// Sökrutan på backoffice-tavlan. Ingen React här — testas i
// src/lib/__tests__/orderSearch.test.ts.

type Item = OrderWithDetails['items'][number]

export const normalizeSearch = (s: string) => s.trim().toLowerCase()

// Produktnamnet personalen ser och namnet leverantören får (vendor_name)
export function itemMatchesSearch(item: Item, q: string): boolean {
  if (!q) return false
  const p = item.product
  return !!p && (p.name.toLowerCase().includes(q) || !!p.vendor_name?.toLowerCase().includes(q))
}

export function orderHasItemMatch(order: OrderWithDetails, q: string): boolean {
  return order.items.some(i => itemMatchesSearch(i, q))
}

// q ska vara normaliserad (normalizeSearch). Tom sökning släpper igenom allt.
export function orderMatchesSearch(order: OrderWithDetails, q: string): boolean {
  if (!q) return true
  return (
    orderHasItemMatch(order, q) ||
    !!order.employee?.name.toLowerCase().includes(q) ||
    !!order.location?.name.toLowerCase().includes(q)
  )
}
