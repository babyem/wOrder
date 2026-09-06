import { describe, it, expect } from 'vitest'
import { buildExpressData, expressOrderCount, mergeExpressLocations } from '../express'
import { order, item, product } from './fixtures'

const tofu = product({ name: 'Tofu', vendor: 'Kho', unit: 'låda' })
const soja = product({ name: 'Soja', vendor: 'Kho', unit: 'st' })
const cups = product({ name: 'Cups', vendor: 'Tingstad', unit: 'krt', tingstad_id: '12345' })

describe('buildExpressData', () => {
  it('samlar väntande varor per leverantör och butik', () => {
    const data = buildExpressData([
      order({ locationName: 'Woso Emporia', items: [item({ product: tofu, quantity: 2 }), item({ product: cups, quantity: 1 })] }),
      order({ locationName: 'Woso Triangeln', items: [item({ product: tofu, quantity: 3 })] }),
    ])
    expect([...data.itemsByVendor.keys()].sort()).toEqual(['Kho', 'Tingstad'])
    expect(data.itemsByVendor.get('Kho')!.get('Woso Emporia')).toEqual([{ product: 'Tofu', quantity: 2, unit: 'låda', artnr: undefined }])
    expect(data.itemsByVendor.get('Kho')!.get('Woso Triangeln')).toEqual([{ product: 'Tofu', quantity: 3, unit: 'låda', artnr: undefined }])
    expect(data.itemsByVendor.get('Tingstad')!.get('Woso Emporia')![0].artnr).toBe('12345')
  })

  it('summerar samma produkt från flera ordrar i samma butik', () => {
    const data = buildExpressData([
      order({ locationName: 'Chao', items: [item({ product: tofu, quantity: 2 })] }),
      order({ locationName: 'Chao', items: [item({ product: tofu, quantity: 5 })] }),
    ])
    expect(data.itemsByVendor.get('Kho')!.get('Chao')).toEqual([{ product: 'Tofu', quantity: 7, unit: 'låda', artnr: undefined }])
    expect(expressOrderCount(data, 'Kho')).toBe(2)
  })

  it('hoppar över klara ordrar, exkluderade varor och redan skickade leverantörer', () => {
    const data = buildExpressData([
      order({ status: 'done', items: [item({ product: tofu, quantity: 1 })] }),
      order({ status: 'stopped', items: [item({ product: tofu, quantity: 1 })] }),
      order({ items: [item({ product: tofu, quantity: 1, notify_excluded: true })] }),
      order({ done_vendors: ['Kho'], items: [item({ product: tofu, quantity: 1 }), item({ product: cups, quantity: 4 })] }),
    ])
    expect(data.itemsByVendor.has('Kho')).toBe(false)
    expect(data.itemsByVendor.get('Tingstad')!.get('Woso Emporia')![0].quantity).toBe(4)
  })

  it('låter vendor_override och unit_override vinna, men tom unit_override faller tillbaka', () => {
    const data = buildExpressData([
      order({ items: [
        item({ product: tofu, quantity: 1, vendor_override: 'Tingstad', unit_override: 'pall' }),
        item({ product: soja, quantity: 1, unit_override: '' }),
      ] }),
    ])
    expect(data.itemsByVendor.get('Tingstad')!.get('Woso Emporia')).toEqual([{ product: 'Tofu', quantity: 1, unit: 'pall', artnr: undefined }])
    expect(data.itemsByVendor.get('Kho')!.get('Woso Emporia')![0].unit).toBe('st')
  })

  it('"ingen beställning" listas per leverantör och markeras klar vid utskick, men räknas inte som ordercard', () => {
    const notice = order({ locationName: 'Lets Grab', no_order_vendor: 'Kho' })
    const real = order({ locationName: 'Woso Emporia', items: [item({ product: tofu, quantity: 1 })] })
    const data = buildExpressData([notice, real])
    expect(data.noOrderByVendor.get('Kho')).toEqual(['Lets Grab'])
    expect(data.orderIdsByVendor.get('Kho')).toEqual(new Set([notice.id, real.id]))
    expect(expressOrderCount(data, 'Kho')).toBe(1)
  })

  it('ignorerar "ingen beställning" som redan är avprickad', () => {
    const data = buildExpressData([order({ no_order_vendor: 'Kho', done_vendors: ['Kho'] })])
    expect(data.noOrderByVendor.size).toBe(0)
    expect(data.orderIdsByVendor.size).toBe(0)
  })
})

describe('mergeExpressLocations', () => {
  const locMap = () => new Map([
    ['Izakai Emporia', [{ product: 'Tofu', quantity: 2, unit: 'låda' }]],
    ['Woso Emporia', [{ product: 'Tofu', quantity: 3, unit: 'låda' }, { product: 'Soja', quantity: 1, unit: 'st' }]],
    ['Chao', [{ product: 'Tofu', quantity: 1, unit: 'låda' }]],
  ])

  it('slår ihop Izakai Emporia i Woso Emporia för Kho och summerar', () => {
    const merged = mergeExpressLocations('Kho', locMap())
    expect([...merged.keys()]).toEqual(['Woso Emporia', 'Chao'])
    expect(merged.get('Woso Emporia')).toEqual([
      { product: 'Tofu', quantity: 5, unit: 'låda' },
      { product: 'Soja', quantity: 1, unit: 'st' },
    ])
  })

  it('matchar leverantör och butik oavsett skiftläge', () => {
    const merged = mergeExpressLocations(' KHO ', new Map([['izakai emporia', [{ product: 'Tofu', quantity: 1, unit: '' }]]]))
    expect([...merged.keys()]).toEqual(['Woso Emporia'])
  })

  it('lämnar andra leverantörer orörda', () => {
    const input = locMap()
    expect(mergeExpressLocations('Tingstad', input)).toBe(input)
  })

  it('muterar inte indata', () => {
    const input = locMap()
    mergeExpressLocations('Kho', input)
    expect(input.get('Izakai Emporia')![0].quantity).toBe(2)
    expect(input.get('Woso Emporia')![0].quantity).toBe(3)
  })
})
