import { supabase } from './supabase'
import { queryClient } from './queryClient'
import type { VendorContact } from './vendorContacts'

export const SEND_LOG_KEY = ['order-send-log'] as const

export interface SendLogEntry {
  id: string
  sent_at: string
  vendor_name: string
  location_names: string[]
  channel: 'email' | 'sms'
  contact_value: string
  contact_label: string | null
  order_ids: string[]
  subject: string | null
  body: string | null
  status: 'sent' | 'failed'
  error: string | null
}

export interface SendLogInput {
  vendorName: string
  contact: VendorContact
  locations: string[]
  orderIds: string[]
  /** Ämnesrad — bara för mail */
  subject?: string
  /** Meddelandetexten som skickades */
  body: string
  /** Felmeddelande — sätts bara när utskicket misslyckades */
  error?: string
}

/**
 * Skriver en rad i order_send_log efter ett mailförsök (lyckat eller inte) eller
 * ett bekräftat SMS. Loggen får aldrig stoppa själva utskicket — fel sväljs och
 * skrivs bara i konsolen.
 */
export async function logSend({ vendorName, contact, locations, orderIds, subject, body, error: sendError }: SendLogInput): Promise<void> {
  const { error } = await supabase.from('order_send_log').insert({
    vendor_name: vendorName,
    location_names: [...new Set(locations.filter(Boolean))],
    channel: contact.type === 'email' ? 'email' : 'sms',
    contact_value: contact.value,
    contact_label: contact.label?.trim() || null,
    order_ids: [...new Set(orderIds.filter(Boolean))],
    subject: contact.type === 'email' ? subject ?? null : null,
    body,
    status: sendError ? 'failed' : 'sent',
    error: sendError ?? null,
  })
  if (error) {
    console.warn('order_send_log insert failed', error)
    return
  }
  queryClient.invalidateQueries({ queryKey: SEND_LOG_KEY })
}
