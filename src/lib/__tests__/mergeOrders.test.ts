import { describe, it, expect } from 'vitest'
import { planMergedOrder, planVendorCardMerge } from '../mergeOrders'
import { order, item, product } from './fixtures'

const tofu = product({ name: 'Tofu' })
const soja = product({ name: 'Soja' })

describe('planMergedOrder', () => {
  it('summerar kvantiteter per produkt över alla ordrar', () => {
    const plan = planMergedOrder([
      order({ items: [item({ product: tofu, quantity: 2 }), item({ product: soja, quantity: 1 })] }),
      order({ items: [item({ product: tofu, quantity: 3 })] }),
    ])
    expect(plan.items).toEqual([
      { product_id: tofu.id, quantity: 5 },
      { product_id: soja.id, quantity: 1 },
    ])
  })

  it('tar butik och anställd från första ordern om inget mål anges', () => {
    const a = order({ locationName: 'Chao', employee_id: 'emp-a' })
    const b = order({ locationName: 'Woso Emporia', employee_id: 'emp-b' })
    const plan = planMergedOrder([a, b])
    expect(plan.locationId).toBe(a.location_id)
    expect(plan.employeeId).toBe('emp-a')
  })

  it('väljer anställd från en order som hör till målbutiken', () => {
    const a = order({ locationName: 'Chao', employee_id: 'emp-a' })
    const b = order({ locationName: 'Woso Emporia', employee_id: 'emp-b' })
    const plan = planMergedOrder([a, b], b.location_id)
    expect(plan.locationId).toBe(b.location_id)
    expect(plan.employeeId).toBe('emp-b')
  })

  it('slår ihop anteckningar och hoppar över tomma', () => {
    const plan = planMergedOrder([
      order({ note: 'Ring innan' }),
      order({ note: null }),
      order({ note: 'Leverans bakvägen' }),
    ])
    expect(plan.note).toBe('Ring innan | Leverans bakvägen')
    expect(planMergedOrder([order()]).note).toBeNull()
  })

  it('kastar på tom lista', () => {
    expect(() => planMergedOrder([])).toThrow()
  })
})

describe('planVendorCardMerge', () => {
  it('flyttar rader från andra valda kort till målleverantören', () => {
    const kho = product({ name: 'Bo yakiniku', vendor: 'Kho' })
    const fdc = product({ name: 'Ca trang', vendor: 'FDC' })
    const a = item({ product: kho, quantity: 2 })
    const b = item({ product: fdc, quantity: 1 })
    const o = order({ items: [a, b] })
    expect(planVendorCardMerge(o, ['Kho', 'FDC'], 'Kho')).toEqual([
      { id: b.id, vendor_override: 'Kho' },
    ])
  })

  it('lämnar kort som inte är valda orörda', () => {
    const kho = product({ vendor: 'Kho' })
    const fdc = product({ vendor: 'FDC' })
    const ting = product({ vendor: 'Tingstad' })
    const c = item({ product: ting, quantity: 1 })
    const o = order({ items: [item({ product: kho, quantity: 1 }), item({ product: fdc, quantity: 1 }), c] })
    const ids = planVendorCardMerge(o, ['Kho', 'FDC'], 'FDC').map(u => u.id)
    expect(ids).not.toContain(c.id)
  })

  it('nollar override när produkten redan tillhör målleverantören', () => {
    const kho = product({ vendor: 'Kho' })
    const moved = item({ product: kho, quantity: 1, vendor_override: 'FDC' })
    const o = order({ items: [moved, item({ product: product({ vendor: 'Kho' }), quantity: 1 })] })
    expect(planVendorCardMerge(o, ['Kho', 'FDC'], 'Kho')).toEqual([
      { id: moved.id, vendor_override: null },
    ])
  })

  it('kastar om målet inte är ett valt kort', () => {
    const o = order({ items: [item({ product: product({ vendor: 'Kho' }), quantity: 1 })] })
    expect(() => planVendorCardMerge(o, ['Kho', 'FDC'], 'Tingstad')).toThrow()
  })
})
