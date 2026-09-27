import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { SEND_LOG_KEY, type SendLogEntry } from '../lib/sendLog'

interface Options {
  /** Bara rader nyare än så här många timmar; utelämna för hela historiken */
  sinceHours?: number
  limit?: number
  enabled?: boolean
}

/** Utskick till leverantörer, nyast först. */
export function useSendLog({ sinceHours, limit = 200, enabled = true }: Options = {}) {
  return useQuery({
    queryKey: [...SEND_LOG_KEY, sinceHours ?? 'all', limit],
    queryFn: async (): Promise<SendLogEntry[]> => {
      let q = supabase
        .from('order_send_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit)
      if (sinceHours) q = q.gte('sent_at', new Date(Date.now() - sinceHours * 3_600_000).toISOString())
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    enabled,
    refetchInterval: 60_000,
  })
}
