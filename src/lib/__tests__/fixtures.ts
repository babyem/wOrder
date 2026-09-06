import type { OrderWithDetails, Product, OrderItem } from '../../types'

let seq = 0
const nextId = (prefix: string) => `${prefix}-${++seq}`

export const product = (over: Partial<Product> = {}): Product => ({
  id: nextId('p'),
  name: over.name ?? 'Produkt',
  vendor_name: null,
  image_url: null,
  category: 'Övrigt',
  vendor: 'Kho',
  unit: 'st',
  active: true,
  sort_order: 0,
  created_at: '2026-09-01T00:00:00Z',
  chefsculinar_id: null,
  chefsculinar_unit: null,
  chefsculinar_unit_qty: null,
  tingstad_id: null,
  tingstad_unit: null,
  tingstad_unit_qty: null,
  tingstad_alt_id: null,
  ...over,
})

type ItemInput = { product: Product | null; quantity: number } & Partial<Omit<OrderItem, 'product_id' | 'quantity'>>

export const item = ({ product: p, quantity, ...over }: ItemInput) => ({
  id: nextId('oi'),
  order_id: '',
  product_id: p?.id ?? nextId('missing'),
  quantity,
  vendor_override: null,
  unit_override: null,
  notify_excluded: false,
  product: p,
  ...over,
})

export const order = (
  over: Partial<OrderWithDetails> & { locationName?: string } = {},
): OrderWithDetails => {
  const { locationName = 'Woso Emporia', ...rest } = over
  const id = rest.id ?? nextId('o')
  const location_id = rest.location_id ?? `loc-${locationName}`
  return {
    id,
    location_id,
    employee_id: rest.employee_id ?? 'emp-1',
    status: 'pending',
    note: null,
    admin_note: null,
    created_at: '2026-09-06T10:00:00Z',
    completed_at: null,
    location: { id: location_id, name: locationName, created_at: '', chefsculinar_customer_id: null, sort_order: 0 },
    employee: null,
    items: [],
    ...rest,
  }
}
