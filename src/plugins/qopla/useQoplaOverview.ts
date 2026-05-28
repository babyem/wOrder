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
    staleTime: 5 * 60 * 1000,
  })
}
