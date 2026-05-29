import { useQuery } from '@tanstack/react-query'

export interface QoplaShopOverview {
  shopId: string
  shopName: string
  totalSales: number
  totalOrders: number
  byChannel: Record<string, { sales: number; orders: number }>
}

interface FetchOptions {
  startISO: string
  endISO: string
}

async function fetchOverview(opts: FetchOptions): Promise<QoplaShopOverview[]> {
  const params = new URLSearchParams({
    action: 'overview',
    start: opts.startISO,
    end: opts.endISO,
  })
  const res = await fetch(`/api/qopla?${params.toString()}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla overview-API fel')
  return json.overview
}

export function useQoplaOverview(opts: FetchOptions) {
  return useQuery({
    queryKey: ['qopla-overview', opts.startISO, opts.endISO],
    queryFn: () => fetchOverview(opts),
    staleTime: Infinity,           // never auto-stale, manual refetch only
    gcTime: 30 * 60 * 1000,        // keep in memory 30 min for preset switches
    placeholderData: prev => prev, // show last data while refetching
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
}
