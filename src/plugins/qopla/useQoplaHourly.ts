import { useQuery } from '@tanstack/react-query'

export interface QoplaHourBucket {
  hour: number      // 0–23
  sales: number
  orders: number
}

interface FetchOptions {
  shopId: string
  startISO: string
  endISO: string
  enabled?: boolean
}

async function fetchHourly(opts: FetchOptions): Promise<QoplaHourBucket[]> {
  const params = new URLSearchParams({
    action: 'hourly',
    shopId: opts.shopId,
    start: opts.startISO,
    end: opts.endISO,
  })
  const res = await fetch(`/api/qopla?${params.toString()}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla timme-API fel')
  return json.hourly
}

export function useQoplaHourly(opts: FetchOptions) {
  return useQuery({
    queryKey: ['qopla-hourly', opts.shopId, opts.startISO, opts.endISO],
    queryFn: () => fetchHourly(opts),
    enabled: opts.enabled !== false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  })
}
