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
  /** 'pending' = SMS-genvägen startad men inte bekräftad än */
  status: 'pending' | 'sent' | 'failed'
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
  /** Rad-id skapat i appen — SMS-genvägen bekräftar raden med det via RPC:n sms_confirm */
  id?: string
  /** Skriv raden som 'pending' (SMS-genvägen startad, inte bekräftad än) */
  pending?: boolean
}

/**
 * Skriver en rad i order_send_log efter ett mailförsök (lyckat eller inte), ett
 * bekräftat SMS, eller som 'pending' när SMS-genvägen startas. Loggen får aldrig
 * stoppa själva utskicket — fel sväljs och skrivs bara i konsolen.
 */
export async function logSend({ vendorName, contact, locations, orderIds, subject, body, error: sendError, id, pending }: SendLogInput): Promise<void> {
  const { error } = await supabase.from('order_send_log').insert({
    ...(id ? { id } : {}),
    vendor_name: vendorName,
    location_names: [...new Set(locations.filter(Boolean))],
    channel: contact.type === 'email' ? 'email' : 'sms',
    contact_value: contact.value,
    contact_label: contact.label?.trim() || null,
    order_ids: [...new Set(orderIds.filter(Boolean))],
    subject: contact.type === 'email' ? subject ?? null : null,
    body,
    status: pending ? 'pending' : sendError ? 'failed' : 'sent',
    error: sendError ?? null,
  })
  if (error) {
    console.warn('order_send_log insert failed', error)
    return
  }
  queryClient.invalidateQueries({ queryKey: SEND_LOG_KEY })
}

/** Status för en rad — används för att se när SMS-genvägen bekräftat utskicket. */
export async function sendLogStatus(id: string): Promise<SendLogEntry['status'] | null> {
  const { data, error } = await supabase.from('order_send_log').select('status').eq('id', id).maybeSingle()
  if (error) {
    console.warn('order_send_log status failed', error)
    return null
  }
  return data?.status ?? null
}

/**
 * Avgör en väntande SMS-rad från appen: sent=true när användaren själv
 * bekräftar ("Klar"), sent=false tar bort raden när genvägen avbröts.
 */
export async function settlePendingSms(id: string, sent: boolean): Promise<void> {
  const q = sent
    ? supabase.from('order_send_log').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id).eq('status', 'pending')
    : supabase.from('order_send_log').delete().eq('id', id).eq('status', 'pending')
  const { error } = await q
  if (error) console.warn('order_send_log settle failed', error)
  queryClient.invalidateQueries({ queryKey: SEND_LOG_KEY })
}
