import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export const VENDOR_GAPS_KEY = ['vendor-gaps'] as const

export interface VendorGap {
  location_id: string
  vendor: string
  days_hit: number
  days_total: number
  usual_time: string | null   // "HH:MM" i Stockholm-tid
  last_order: string | null   // YYYY-MM-DD
}

/** Leverantörer som brukar få en order idag men inte fått någon ännu (RPC i migration 037). */
export function useVendorGaps() {
  return useQuery({
    queryKey: VENDOR_GAPS_KEY,
    queryFn: async (): Promise<VendorGap[]> => {
      const { data, error } = await supabase.rpc('vendor_gaps_today')
      if (error) return [] // RPC saknas innan migration 037 — visa bara inget
      return data ?? []
    },
    refetchInterval: 60_000,
  })
}

export const stockholmToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

/** "Dölj idag" — spökkortet försvinner för alla enheter tills imorgon. */
export function useDismissGap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ locationId, vendor }: { locationId: string; vendor: string }) => {
      const { error } = await supabase
        .from('order_gap_dismissals')
        .upsert({ location_id: locationId, vendor, day: stockholmToday() })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: VENDOR_GAPS_KEY }),
  })
}
