import type { OrderWithDetails } from '../types'

// Ren logik bakom Express-knapparna i backoffice. Ingen React här — testas i
// src/lib/__tests__/express.test.ts.

export interface VendorItem { product: string; quantity: number; unit: string; artnr?: string }
export type LocationItems = Map<string, VendorItem[]> // butik -> varor

export interface ExpressData {
  itemsByVendor: Map<string, LocationItems>       // leverantör -> butik -> varor
  orderIdsByVendor: Map<string, Set<string>>      // leverantör -> ordrar som markeras klara vid utskick
  noOrderByVendor: Map<string, string[]>          // leverantör -> butiker som sagt "ingen beställning"
  noOrderIds: Set<string>                         // räknas inte som ordercard i express-knappen
}

const addItem = (list: VendorItem[], item: VendorItem) => {
  const existing = list.find(e => e.product === item.product)
  if (existing) {
    existing.quantity += item.quantity
    if (!existing.unit && item.unit) existing.unit = item.unit
    if (!existing.artnr && item.artnr) existing.artnr = item.artnr
  } else {
    list.push({ ...item })
  }
}

// Alla väntande varor per leverantör, över samtliga pending-orders.
// Hoppar över varor som är exkluderade eller vars leverantör redan är klar på ordern.
export function buildExpressData(orders: OrderWithDetails[]): ExpressData {
  const itemsByVendor = new Map<string, LocationItems>()
  const orderIdsByVendor = new Map<string, Set<string>>()
  const noOrderByVendor = new Map<string, string[]>()
  const noOrderIds = new Set<string>()

  const trackOrder = (vendor: string, orderId: string) => {
    if (!orderIdsByVendor.has(vendor)) orderIdsByVendor.set(vendor, new Set())
    orderIdsByVendor.get(vendor)!.add(orderId)
  }

  for (const order of orders) {
    if (order.status !== 'pending') continue
    const doneSet = new Set(order.done_vendors ?? [])
    const loc = order.location?.name ?? 'Unknown'

    // "Ingen beställning" — inga items, men express-utskicket ska markera den som klar
    if (order.no_order_vendor) {
      const v = order.no_order_vendor
      if (doneSet.has(v)) continue
      const locs = noOrderByVendor.get(v) ?? []
      if (!locs.includes(loc)) locs.push(loc)
      noOrderByVendor.set(v, locs)
      noOrderIds.add(order.id)
      trackOrder(v, order.id)
      continue
    }

    for (const item of order.items) {
      if (item.notify_excluded) continue
      const v = item.vendor_override ?? item.product?.vendor
      if (!v || doneSet.has(v)) continue
      if (!itemsByVendor.has(v)) itemsByVendor.set(v, new Map())
      const locMap = itemsByVendor.get(v)!
      const list = locMap.get(loc) ?? []
      addItem(list, {
        product: item.product?.vendor_name ?? item.product?.name ?? '?',
        quantity: item.quantity,
        // || (inte ??) så tom unit_override faller tillbaka på produktens enhet
        unit: item.unit_override || item.product?.unit || '',
        artnr: item.product?.tingstad_id || item.product?.tingstad_alt_id || undefined,
      })
      locMap.set(loc, list)
      trackOrder(v, order.id)
    }
  }

  return { itemsByVendor, orderIdsByVendor, noOrderByVendor, noOrderIds }
}

// Antal ordercard (inte artiklar) som går med i utskicket för en leverantör
export function expressOrderCount(data: ExpressData, vendor: string): number {
  return [...(data.orderIdsByVendor.get(vendor) ?? [])].filter(id => !data.noOrderIds.has(id)).length
}

// Vissa leverantörer beställer för flera butiker under ett och samma namn.
// Kho: Izakai Emporia går ihop med Woso Emporia, Lets Grab med Woso Triangeln.
// Nycklar är gemener; leverantörs- och butiksnamn matchas skiftlägesokänsligt.
export const EXPRESS_LOCATION_MERGE: Record<string, Record<string, string>> = {
  kho: {
    'izakai emporia': 'Woso Emporia',
    'lets grab': 'Woso Triangeln',
  },
}

// Slår ihop butiker enligt reglerna och summerar identiska produkter.
// Muterar inte indata — expressData är memoiserad.
export function mergeExpressLocations(
  vendorName: string,
  locMap: LocationItems,
  rulesByVendor: Record<string, Record<string, string>> = EXPRESS_LOCATION_MERGE,
): LocationItems {
  const rules = rulesByVendor[vendorName.trim().toLowerCase()]
  if (!rules) return locMap
  const merged: LocationItems = new Map()
  for (const [loc, items] of locMap) {
    const target = rules[loc.trim().toLowerCase()] ?? loc
    const list = merged.get(target) ?? []
    for (const item of items) addItem(list, item)
    merged.set(target, list)
  }
  return merged
}
