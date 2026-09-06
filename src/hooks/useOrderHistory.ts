import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { buildStats, type HistoryRow, type OrderStats } from '../lib/suggest'

const EMPTY: OrderStats = { products: new Map(), vendors: new Map() }

/**
 * Butikens orderhistorik (90 dagar) via RPC:n location_order_history (migration 032),
 * färdigräknad till statistik per produkt/leverantör. Personalsidan är anonym, så
 * detta är enda vägen till historiken.
 */
export function useOrderHistoryStats(locationId: string) {
  const query = useQuery({
    queryKey: ['order-history', locationId],
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data, error } = await supabase.rpc('location_order_history', { p_location_id: locationId, p_days: 90 })
      if (error) throw error
      return ((data ?? []) as HistoryRow[]).map(r => ({ ...r, quantity: Number(r.quantity) }))
    },
    enabled: !!locationId,
    staleTime: 5 * 60_000,
  })

  const stats = useMemo(() => (query.data ? buildStats(query.data) : EMPTY), [query.data])
  return { stats, isLoading: query.isLoading, hasData: !!query.data?.length }
}
