import { describe, it, expect } from 'vitest'
import { splitQuantity, splitLines, splitLocations, formatSplitText, type SplitRule } from '../vendorSplit'

const rules: SplitRule[] = [{
  location: 'Woso Triangeln',
  label: 'Letsgrab',
  items: [
    { product_id: 'rakor', share: 1 },
    { product_id: 'edamame', share: 0.5 },
    { product_id: 'jordnotter', share: 1 },
  ],
}]

const line = (product_id: string, name: string, quantity: number, unit = 'Lådor') => ({ product_id, name, quantity, unit })
const fmt = (l: ReturnType<typeof line>) => `${l.name}: ${l.quantity} ${l.unit}`

describe('splitQuantity', () => {
  it('hela, halva och udda antal (avrundas uppåt till rubriken)', () => {
    expect(splitQuantity(5, 1)).toBe(5)
    expect(splitQuantity(4, 0.5)).toBe(2)
    expect(splitQuantity(5, 0.5)).toBe(3)
    expect(splitQuantity(1, 0.5)).toBe(1)
    expect(splitQuantity(3, 0)).toBe(0)
  })
})

describe('splitLines', () => {
  it('Easy Asia-exemplet: Letsgrab först, resten under Woso Triangeln', () => {
    const blocks = splitLines(rules, 'Woso Triangeln', [
      line('ris', 'Sushi Ris', 4, 'St'),
      line('rakor', 'Handskalade räkor', 5),
      line('ebi', 'EBI 4L (Räkor Sushi)', 1),
      line('edamame', 'Edamame utan skal', 4),
    ])
    expect(blocks.map(b => b.label)).toEqual(['Letsgrab', 'Woso Triangeln'])
    expect(blocks[0].lines.map(l => [l.name, l.quantity])).toEqual([['Handskalade räkor', 5], ['Edamame utan skal', 2]])
    expect(blocks[1].lines.map(l => [l.name, l.quantity])).toEqual([['Sushi Ris', 4], ['EBI 4L (Räkor Sushi)', 1], ['Edamame utan skal', 2]])
  })

  it('rör inte andra butiker eller ordrar utan matchande varor', () => {
    const lines = [line('rakor', 'Handskalade räkor', 5)]
    expect(splitLines(rules, 'Woso Emporia', lines)).toEqual([{ label: 'Woso Emporia', lines }])
    const other = [line('ris', 'Sushi Ris', 4)]
    expect(splitLines(rules, 'Woso Triangeln', other)).toEqual([{ label: 'Woso Triangeln', lines: other }])
  })

  it('tar bort butiksblocket om allt flyttas', () => {
    const blocks = splitLines(rules, 'woso triangeln', [line('rakor', 'Handskalade räkor', 2), line('edamame', 'Edamame', 1)])
    expect(blocks.map(b => b.label)).toEqual(['Letsgrab'])
  })

  it('muterar inte indata', () => {
    const lines = [line('edamame', 'Edamame', 4)]
    splitLines(rules, 'Woso Triangeln', lines)
    expect(lines[0].quantity).toBe(4)
  })

  it('utan regler eller med null', () => {
    const lines = [line('rakor', 'Handskalade räkor', 5)]
    expect(splitLines(null, 'Woso Triangeln', lines)).toEqual([{ label: 'Woso Triangeln', lines }])
  })
})

describe('formatSplitText', () => {
  it('oförändrat format när inget delas', () => {
    expect(formatSplitText(rules, 'Chao', [line('rakor', 'Handskalade räkor', 5)], fmt))
      .toBe('Chao\n\nHandskalade räkor: 5 Lådor')
  })

  it('en text med båda blocken när det delas', () => {
    expect(formatSplitText(rules, 'Woso Triangeln', [line('ris', 'Sushi Ris', 4, 'St'), line('edamame', 'Edamame utan skal', 4)], fmt))
      .toBe('Letsgrab\nEdamame utan skal: 2 Lådor\n\nWoso Triangeln\nSushi Ris: 4 St\nEdamame utan skal: 2 Lådor')
  })
})

describe('splitLocations', () => {
  it('lägger rubrikblocket direkt före butiken och behåller ordningen', () => {
    const out = splitLocations(rules, [
      { loc: 'Woso Emporia', items: [line('rakor', 'Handskalade räkor', 1)] },
      { loc: 'Woso Triangeln', items: [line('rakor', 'Handskalade räkor', 5), line('ris', 'Sushi Ris', 4)] },
    ])
    expect(out.map(l => l.loc)).toEqual(['Woso Emporia', 'Letsgrab', 'Woso Triangeln'])
  })
})
