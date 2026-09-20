// Kontaktvägar per leverantör (migration 033). En leverantör kan ha flera
// mailadresser/telefonnummer, var och en med ett valfritt smeknamn så att
// backoffice minns vilken som är vilken ("Kontoret", "Anna", "Jour").

export type ContactType = 'email' | 'phone'

export interface VendorContact {
  id: string
  type: ContactType
  value: string
  label?: string
}

interface VendorLike {
  contacts?: VendorContact[] | null
  email?: string | null
  phone?: string | null
}

/**
 * Kontaktlistan för en leverantör. Faller tillbaka på de gamla email/phone-
 * kolumnerna om contacts saknas (t.ex. innan migration 033 körts).
 */
export function vendorContacts(v: VendorLike | null | undefined): VendorContact[] {
  if (!v) return []
  if (Array.isArray(v.contacts) && v.contacts.length > 0) {
    return v.contacts.filter(c => c && typeof c.value === 'string' && c.value.trim() !== '')
  }
  const out: VendorContact[] = []
  if (v.email) out.push({ id: 'legacy-email', type: 'email', value: v.email })
  if (v.phone) out.push({ id: 'legacy-phone', type: 'phone', value: v.phone })
  return out
}

/**
 * Knapptext vid notify. Smeknamnet vinner; saknas det visas bara "Email"/"SMS"
 * när kontakten är ensam av sin typ, annars själva adressen så man kan skilja dem åt.
 */
export function contactLabel(c: VendorContact, all: VendorContact[]): string {
  const base = c.type === 'email' ? 'Email' : 'SMS'
  const label = c.label?.trim()
  if (label) return `${base} · ${label}`
  const sameType = all.filter(o => o.type === c.type)
  return sameType.length > 1 ? `${base} · ${c.value}` : base
}

/** Kort namn för toasts: smeknamn om det finns, annars adressen. */
export function contactShortName(c: VendorContact): string {
  return c.label?.trim() || c.value
}

/** Speglar första kontakten av varje typ till de gamla kolumnerna (telegram-boten läser dem). */
export function legacyContactFields(contacts: VendorContact[]): { email: string | null; phone: string | null } {
  return {
    email: contacts.find(c => c.type === 'email')?.value ?? null,
    phone: contacts.find(c => c.type === 'phone')?.value ?? null,
  }
}

export function newContactId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// Kommentaren hamnar under orderlistan i meddelandet som skickas till leverantören.
export function withComment(body: string, comment: string): string {
  const c = comment.trim()
  return c ? `${body}\n\n${c}` : body
}
