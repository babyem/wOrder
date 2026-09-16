import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { SEND_LOG_KEY, type SendLogEntry } from '../lib/sendLog'

/** Senaste utskicken till leverantörer, nyast först. */
export function useSendLog(limit = 8) {
  return useQuery({
    queryKey: [...SEND_LOG_KEY, limit],
    queryFn: async (): Promise<SendLogEntry[]> => {
      const { data, error } = await supabase
        .from('order_send_log')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 60_000,
  })
}
