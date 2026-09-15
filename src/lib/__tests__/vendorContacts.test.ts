import { describe, it, expect } from 'vitest'
import { vendorContacts, contactLabel, legacyContactFields, type VendorContact } from '../vendorContacts'

const email = (id: string, value: string, label?: string): VendorContact => ({ id, type: 'email', value, label })
const phone = (id: string, value: string, label?: string): VendorContact => ({ id, type: 'phone', value, label })

describe('vendorContacts', () => {
  it('returns contacts when present, dropping empty values', () => {
    const list = vendorContacts({ contacts: [email('a', 'a@x.se'), email('b', '  ')], email: 'old@x.se' })
    expect(list.map(c => c.id)).toEqual(['a'])
  })
  it('falls back to legacy email/phone when contacts is empty', () => {
    expect(vendorContacts({ contacts: [], email: 'a@x.se', phone: '+46701' }).map(c => [c.type, c.value]))
      .toEqual([['email', 'a@x.se'], ['phone', '+46701']])
    expect(vendorContacts({ contacts: null, email: null, phone: '+46701' })).toHaveLength(1)
  })
  it('handles missing vendor', () => {
    expect(vendorContacts(undefined)).toEqual([])
  })
})

describe('contactLabel', () => {
  it('uses the nickname when set', () => {
    const all = [email('a', 'a@x.se', 'Kontoret')]
    expect(contactLabel(all[0], all)).toBe('Email · Kontoret')
  })
  it('shows just the type when it is the only one of its kind', () => {
    const all = [email('a', 'a@x.se'), phone('p', '+46701')]
    expect(contactLabel(all[0], all)).toBe('Email')
    expect(contactLabel(all[1], all)).toBe('SMS')
  })
  it('shows the address when several unlabeled contacts share a type', () => {
    const all = [email('a', 'a@x.se'), email('b', 'b@x.se', 'Anna')]
    expect(contactLabel(all[0], all)).toBe('Email · a@x.se')
    expect(contactLabel(all[1], all)).toBe('Email · Anna')
  })
})

describe('legacyContactFields', () => {
  it('mirrors the first contact of each type', () => {
    expect(legacyContactFields([phone('p', '+1'), email('a', 'a@x.se'), email('b', 'b@x.se')]))
      .toEqual({ email: 'a@x.se', phone: '+1' })
    expect(legacyContactFields([])).toEqual({ email: null, phone: null })
  })
})
