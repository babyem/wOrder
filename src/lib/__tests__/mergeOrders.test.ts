import { describe, it, expect } from 'vitest'
import { planMergedOrder } from '../mergeOrders'
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
