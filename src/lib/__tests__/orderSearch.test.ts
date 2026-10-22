import { describe, it, expect } from 'vitest'
import { normalizeSearch, itemMatchesSearch, orderHasItemMatch, orderMatchesSearch } from '../orderSearch'
import { order, item, product } from './fixtures'

const tofu = product({ name: 'Tofu', vendor_name: 'Tofu fast 400g' })
const soja = product({ name: 'Sojasås' })

describe('orderSearch', () => {
  it('normaliserar skiftläge och blanksteg', () => {
    expect(normalizeSearch('  TOFU ')).toBe('tofu')
  })

  it('hittar en order på produktnamn, även en del av namnet', () => {
    const o = order({ items: [item({ product: soja, quantity: 1 }), item({ product: tofu, quantity: 2 })] })
    expect(orderMatchesSearch(o, 'tof')).toBe(true)
    expect(orderHasItemMatch(o, 'sås')).toBe(true)
    expect(orderMatchesSearch(o, 'kyckling')).toBe(false)
  })

  it('hittar på leverantörens produktnamn (vendor_name)', () => {
    expect(itemMatchesSearch(item({ product: tofu, quantity: 1 }), '400g')).toBe(true)
  })

  it('markerar bara raderna som matchar', () => {
    const o = order({ items: [item({ product: soja, quantity: 1 }), item({ product: tofu, quantity: 2 })] })
    expect(o.items.filter(i => itemMatchesSearch(i, 'tofu')).map(i => i.product?.name)).toEqual(['Tofu'])
  })

  it('hittar fortfarande på butik och personal', () => {
    const o = order({ locationName: 'Woso Triangeln', employee: { id: 'e', name: 'Anna', location_id: '', created_at: '' } as never })
    expect(orderMatchesSearch(o, 'triangeln')).toBe(true)
    expect(orderMatchesSearch(o, 'anna')).toBe(true)
    expect(orderHasItemMatch(o, 'anna')).toBe(false)
  })

  it('tom sökning släpper igenom allt, raderad produkt kraschar inte', () => {
    const o = order({ items: [item({ product: null, quantity: 1 })] })
    expect(orderMatchesSearch(o, '')).toBe(true)
    expect(orderMatchesSearch(o, 'tofu')).toBe(false)
  })
})
