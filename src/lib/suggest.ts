// Ren logik bakom "Vanlig beställning" och rimlighetskollen i personalappen.
// Ingen React här — testas i src/lib/__tests__/suggest.test.ts.

export interface HistoryRow {
  order_id: string
  created_at: string
  product_id: string
  quantity: number
  unit: string | null
  vendor: string | null
}

export interface ProductStat {
  product_id: string
  vendor: string
  /** Antal ordrar (från den här leverantören) där produkten fanns med */
  orders: number
  /** Antal ordrar från leverantören totalt */
  vendorOrders: number
  /** orders / vendorOrders */
  share: number
  /** Antal per order, en post per order */
  quantities: number[]
  /** Antal per order grupperat på veckodag (0 = söndag) */
  byWeekday: Map<number, number[]>
  median: number
  max: number
  unit: string | null
  lastOrdered: string
}

export interface VendorStat {
  vendor: string
  orders: number
  lastOrdered: string
}

export interface OrderStats {
  products: Map<string, ProductStat>
  vendors: Map<string, VendorStat>
}

export interface SuggestedItem {
  product_id: string
  quantity: number
  unit: string | null
  /** t.ex. 8 av 12 */
  orders: number
  vendorOrders: number
}

export interface VendorSuggestion {
  vendor: string
  basedOn: number
  lastOrdered: string
  items: SuggestedItem[]
}

export type CartWarning =
  | { kind: 'high' | 'low'; product_id: string; quantity: number; usual: number; unit: string | null }
  | { kind: 'forgotten'; product_id: string; vendor: string; quantity: number; unit: string | null; orders: number; vendorOrders: number }

export interface CartLine {
  product_id: string
  quantity: number
  vendor: string | null
}

export const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const mostCommon = <T,>(xs: T[]): T | null => {
  const counts = new Map<T, number>()
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1)
  let best: T | null = null
  let bestN = 0
  for (const [x, n] of counts) if (n > bestN) { best = x; bestN = n }
  return best
}

/** Slår ihop orderrader till statistik per produkt och leverantör. */
export function buildStats(rows: HistoryRow[]): OrderStats {
  // Antal per (order, produkt) — samma produkt två gånger i en order summeras
  const perOrder = new Map<string, { created_at: string; vendor: string; quantity: number; unit: string | null }>()
  const vendorOrderIds = new Map<string, Set<string>>()
  const vendorLast = new Map<string, string>()

  for (const r of rows) {
    const vendor = r.vendor ?? 'Övrigt'
    const key = `${r.order_id}|${r.product_id}`
    const existing = perOrder.get(key)
    if (existing) existing.quantity += r.quantity
    else perOrder.set(key, { created_at: r.created_at, vendor, quantity: r.quantity, unit: r.unit })

    if (!vendorOrderIds.has(vendor)) vendorOrderIds.set(vendor, new Set())
    vendorOrderIds.get(vendor)!.add(r.order_id)
    if (!vendorLast.has(vendor) || vendorLast.get(vendor)! < r.created_at) vendorLast.set(vendor, r.created_at)
  }

  const acc = new Map<string, { vendor: string; quantities: number[]; byWeekday: Map<number, number[]>; units: (string | null)[]; last: string }>()
  for (const [key, e] of perOrder) {
    const product_id = key.split('|')[1]
    if (!acc.has(product_id)) acc.set(product_id, { vendor: e.vendor, quantities: [], byWeekday: new Map(), units: [], last: e.created_at })
    const a = acc.get(product_id)!
    a.quantities.push(e.quantity)
    a.units.push(e.unit)
    if (e.created_at > a.last) a.last = e.created_at
    const dow = new Date(e.created_at).getDay()
    a.byWeekday.set(dow, [...(a.byWeekday.get(dow) ?? []), e.quantity])
  }

  const products = new Map<string, ProductStat>()
  for (const [product_id, a] of acc) {
    const vendorOrders = vendorOrderIds.get(a.vendor)?.size ?? 0
    products.set(product_id, {
      product_id,
      vendor: a.vendor,
      orders: a.quantities.length,
      vendorOrders,
      share: vendorOrders ? a.quantities.length / vendorOrders : 0,
      quantities: a.quantities,
      byWeekday: a.byWeekday,
      median: median(a.quantities),
      max: Math.max(...a.quantities),
      unit: mostCommon(a.units),
      lastOrdered: a.last,
    })
  }

  const vendors = new Map<string, VendorStat>()
  for (const [vendor, ids] of vendorOrderIds) {
    vendors.set(vendor, { vendor, orders: ids.size, lastOrdered: vendorLast.get(vendor)! })
  }

  return { products, vendors }
}

export interface SuggestOptions {
  /** Datum förslaget gäller — styr veckodagsjusterat antal */
  now?: Date
  /** Minsta andel av leverantörens ordrar produkten måste finnas i */
  minShare?: number
  /** Minsta antal ordrar produkten måste finnas i */
  minOrders?: number
  /** Minsta antal ordrar från leverantören för att föreslå något alls */
  minVendorOrders?: number
}

/** Föreslaget antal: median för samma veckodag om det finns minst två datapunkter, annars total median. */
export function usualQuantity(stat: ProductStat, now: Date): number {
  const sameDay = stat.byWeekday.get(now.getDay()) ?? []
  const q = sameDay.length >= 2 ? median(sameDay) : stat.median
  return Math.max(1, Math.round(q))
}

/** "Vanlig beställning" per leverantör: produkter som brukar vara med, med typiskt antal. */
export function suggestUsualOrder(stats: OrderStats, opts: SuggestOptions = {}): VendorSuggestion[] {
  const now = opts.now ?? new Date()
  const minShare = opts.minShare ?? 0.5
  const minOrders = opts.minOrders ?? 2
  const minVendorOrders = opts.minVendorOrders ?? 3

  const byVendor = new Map<string, SuggestedItem[]>()
  for (const stat of stats.products.values()) {
    if (stat.vendorOrders < minVendorOrders) continue
    if (stat.orders < minOrders || stat.share < minShare) continue
    const list = byVendor.get(stat.vendor) ?? []
    list.push({
      product_id: stat.product_id,
      quantity: usualQuantity(stat, now),
      unit: stat.unit,
      orders: stat.orders,
      vendorOrders: stat.vendorOrders,
    })
    byVendor.set(stat.vendor, list)
  }

  const result: VendorSuggestion[] = []
  for (const [vendor, items] of byVendor) {
    const v = stats.vendors.get(vendor)!
    items.sort((a, b) => b.orders - a.orders || a.product_id.localeCompare(b.product_id))
    result.push({ vendor, basedOn: v.orders, lastOrdered: v.lastOrdered, items })
  }
  // Leverantörer man beställer oftast från först
  result.sort((a, b) => b.basedOn - a.basedOn || a.vendor.localeCompare(b.vendor))
  return result
}

export interface CheckOptions {
  now?: Date
  /** Antal ordrar som krävs innan vi vågar säga något om antalet */
  minOrders?: number
  /** Andel som krävs för att en saknad produkt ska räknas som "glömd" */
  forgottenShare?: number
}

/**
 * Rimlighetskoll av korgen mot historiken:
 *  - high: antalet är minst 3× det vanliga och över det högsta som beställts
 *  - low:  antalet är högst en tredjedel av det vanliga (bara när det vanliga är ≥ 4)
 *  - forgotten: produkt som nästan alltid är med från en leverantör som finns i korgen, men saknas nu
 */
export function checkCart(cart: CartLine[], stats: OrderStats, opts: CheckOptions = {}): CartWarning[] {
  const now = opts.now ?? new Date()
  const minOrders = opts.minOrders ?? 3
  const forgottenShare = opts.forgottenShare ?? 0.6

  const warnings: CartWarning[] = []
  const inCart = new Set(cart.map(c => c.product_id))
  const cartVendors = new Set(cart.map(c => c.vendor ?? 'Övrigt'))

  for (const line of cart) {
    const stat = stats.products.get(line.product_id)
    if (!stat || stat.orders < minOrders) continue
    const usual = usualQuantity(stat, now)
    if (line.quantity >= usual * 3 && line.quantity > stat.max) {
      warnings.push({ kind: 'high', product_id: line.product_id, quantity: line.quantity, usual, unit: stat.unit })
    } else if (usual >= 4 && line.quantity * 3 <= usual) {
      warnings.push({ kind: 'low', product_id: line.product_id, quantity: line.quantity, usual, unit: stat.unit })
    }
  }

  for (const stat of stats.products.values()) {
    if (inCart.has(stat.product_id)) continue
    if (!cartVendors.has(stat.vendor)) continue
    if (stat.orders < minOrders || stat.share < forgottenShare) continue
    warnings.push({
      kind: 'forgotten',
      product_id: stat.product_id,
      vendor: stat.vendor,
      quantity: usualQuantity(stat, now),
      unit: stat.unit,
      orders: stat.orders,
      vendorOrders: stat.vendorOrders,
    })
  }

  return warnings
}
