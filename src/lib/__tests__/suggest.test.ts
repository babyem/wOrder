import { describe, it, expect } from 'vitest'
import { buildStats, suggestUsualOrder, checkCart, usualQuantity, median, type HistoryRow } from '../suggest'

// Helpers: en order = flera rader med samma order_id och datum
let seq = 0
const day = (d: number) => `2026-08-${String(d).padStart(2, '0')}T18:00:00Z`
const orderRows = (created_at: string, lines: [string, number, string?][], vendor = 'Gården'): HistoryRow[] => {
  const order_id = `o${++seq}`
  return lines.map(([product_id, quantity, unit]) => ({ order_id, created_at, product_id, quantity, unit: unit ?? 'st', vendor }))
}

// 6 Gården-ordrar: provencomix + avokado varje gång, gurka 4 av 6, körsbärstomat 1 av 6
const garden: HistoryRow[] = [
  ...orderRows(day(1),  [['prov', 5, 'påsar'], ['avo', 1, 'lådor'], ['gurka', 1]]),
  ...orderRows(day(4),  [['prov', 6, 'påsar'], ['avo', 1, 'lådor'], ['gurka', 1]]),
  ...orderRows(day(8),  [['prov', 5, 'påsar'], ['avo', 1, 'lådor']]),
  ...orderRows(day(11), [['prov', 5, 'påsar'], ['avo', 2, 'lådor'], ['gurka', 1], ['tomat', 1]]),
  ...orderRows(day(15), [['prov', 6, 'påsar'], ['avo', 1, 'lådor'], ['gurka', 1]]),
  ...orderRows(day(18), [['prov', 5, 'påsar'], ['avo', 1, 'lådor']]),
]
// 3 FDC-ordrar med lax
const fdc: HistoryRow[] = [
  ...orderRows(day(2),  [['lax', 15, 'kg']], 'FDC'),
  ...orderRows(day(9),  [['lax', 10, 'kg']], 'FDC'),
  ...orderRows(day(16), [['lax', 20, 'kg']], 'FDC'),
]
// 1 Nassim-order — för lite underlag
const nassim: HistoryRow[] = orderRows(day(3), [['cola', 8, 'flak']], 'Nassim')

const stats = buildStats([...garden, ...fdc, ...nassim])

describe('median', () => {
  it('hanterar udda, jämna och tomma listor', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('buildStats', () => {
  it('räknar andel mot leverantörens ordrar, inte alla ordrar', () => {
    const gurka = stats.products.get('gurka')!
    expect(gurka.orders).toBe(4)
    expect(gurka.vendorOrders).toBe(6)
    expect(gurka.share).toBeCloseTo(4 / 6)
    expect(stats.vendors.get('FDC')!.orders).toBe(3)
  })

  it('summerar samma produkt två gånger i en order', () => {
    const s = buildStats([
      { order_id: 'x', created_at: day(1), product_id: 'p', quantity: 2, unit: 'st', vendor: 'V' },
      { order_id: 'x', created_at: day(1), product_id: 'p', quantity: 3, unit: 'st', vendor: 'V' },
    ])
    expect(s.products.get('p')!.quantities).toEqual([5])
  })

  it('tar vanligaste enheten', () => {
    expect(stats.products.get('prov')!.unit).toBe('påsar')
    expect(stats.products.get('lax')!.median).toBe(15)
  })
})

describe('suggestUsualOrder', () => {
  const suggestions = suggestUsualOrder(stats, { now: new Date('2026-09-09T12:00:00Z') })

  it('föreslår produkter som brukar vara med, oftast beställda först', () => {
    const garden = suggestions.find(s => s.vendor === 'Gården')!
    expect(garden.basedOn).toBe(6)
    expect(garden.items.map(i => i.product_id)).toEqual(['avo', 'prov', 'gurka'])
    expect(garden.items.find(i => i.product_id === 'prov')!.quantity).toBe(5)
    expect(garden.items.find(i => i.product_id === 'avo')!.quantity).toBe(1)
  })

  it('hoppar över sällanköp och leverantörer med för lite underlag', () => {
    const garden = suggestions.find(s => s.vendor === 'Gården')!
    expect(garden.items.some(i => i.product_id === 'tomat')).toBe(false)
    expect(suggestions.some(s => s.vendor === 'Nassim')).toBe(false)
  })

  it('sorterar leverantörer efter hur ofta man beställer', () => {
    expect(suggestions.map(s => s.vendor)).toEqual(['Gården', 'FDC'])
  })
})

describe('usualQuantity', () => {
  it('använder veckodagens median när det finns minst två datapunkter', () => {
    // Måndagar: 10, 10. Övriga dagar: 30.
    const rows: HistoryRow[] = [
      ...orderRows('2026-08-03T10:00:00Z', [['p', 10]]), // mån
      ...orderRows('2026-08-10T10:00:00Z', [['p', 10]]), // mån
      ...orderRows('2026-08-05T10:00:00Z', [['p', 30]]), // ons
      ...orderRows('2026-08-12T10:00:00Z', [['p', 30]]), // ons
      ...orderRows('2026-08-07T10:00:00Z', [['p', 30]]), // fre
    ]
    const stat = buildStats(rows).products.get('p')!
    expect(usualQuantity(stat, new Date('2026-08-17T10:00:00Z'))).toBe(10) // måndag
    expect(usualQuantity(stat, new Date('2026-08-19T10:00:00Z'))).toBe(30) // onsdag
    expect(usualQuantity(stat, new Date('2026-08-15T10:00:00Z'))).toBe(30) // lördag → total median
  })
})

describe('checkCart', () => {
  const now = new Date('2026-09-09T12:00:00Z')

  it('varnar för ovanligt högt antal', () => {
    const w = checkCart([{ product_id: 'prov', quantity: 50, vendor: 'Gården' }, { product_id: 'avo', quantity: 1, vendor: 'Gården' }, { product_id: 'gurka', quantity: 1, vendor: 'Gården' }], stats, { now })
    expect(w).toEqual([{ kind: 'high', product_id: 'prov', quantity: 50, usual: 5, unit: 'påsar' }])
  })

  it('varnar inte för högt antal som beställts förut', () => {
    // lax: 10, 15, 20 — 20 är max, alltså inte konstigt
    expect(checkCart([{ product_id: 'lax', quantity: 20, vendor: 'FDC' }], stats, { now })).toEqual([])
  })

  it('varnar för ovanligt lågt antal bara när det vanliga är stort', () => {
    expect(checkCart([{ product_id: 'lax', quantity: 5, vendor: 'FDC' }], stats, { now }))
      .toEqual([{ kind: 'low', product_id: 'lax', quantity: 5, usual: 15, unit: 'kg' }])
    // avokado: vanligt 1 — inget lågt-larm möjligt
    const w = checkCart([{ product_id: 'avo', quantity: 1, vendor: 'Gården' }, { product_id: 'prov', quantity: 5, vendor: 'Gården' }, { product_id: 'gurka', quantity: 1, vendor: 'Gården' }], stats, { now })
    expect(w).toEqual([])
  })

  it('påminner om glömda produkter från leverantörer som finns i korgen', () => {
    const w = checkCart([{ product_id: 'prov', quantity: 5, vendor: 'Gården' }], stats, { now })
    expect(w.map(x => x.product_id).sort()).toEqual(['avo', 'gurka'])
    const avo = w.find(x => x.product_id === 'avo')!
    expect(avo).toMatchObject({ kind: 'forgotten', vendor: 'Gården', quantity: 1, orders: 6, vendorOrders: 6 })
  })

  it('tjatar inte om leverantörer man inte beställer från idag', () => {
    const w = checkCart([{ product_id: 'lax', quantity: 15, vendor: 'FDC' }], stats, { now })
    expect(w).toEqual([])
  })

  it('kräver underlag innan den säger något', () => {
    // cola: 1 order — ingen varning för 80 flak
    expect(checkCart([{ product_id: 'cola', quantity: 80, vendor: 'Nassim' }], stats, { now })).toEqual([])
  })
})
