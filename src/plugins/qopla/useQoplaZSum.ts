import { useQuery } from '@tanstack/react-query'
import type { QoplaShopOverview } from './useQoplaOverview'

interface FetchOptions {
  startISO: string
  endISO: string
}

async function fetchZSum(opts: FetchOptions): Promise<QoplaShopOverview[]> {
  const params = new URLSearchParams({ action: 'zsum', start: opts.startISO, end: opts.endISO })
  const res = await fetch(`/api/qopla?${params.toString()}`)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla zsum API fel')
  return (json.zsum as Array<{
    shopId: string; shopName: string; totalSales: number; totalOrders: number
  }>).map(s => ({
    shopId:      s.shopId,
    shopName:    s.shopName,
    totalSales:  s.totalSales,
    totalOrders: s.totalOrders,
    byChannel:   {},
  }))
}

export function useQoplaZSum(opts: FetchOptions) {
  return useQuery({
    queryKey: ['qopla-zsum', opts.startISO, opts.endISO],
    queryFn:  () => fetchZSum(opts),
    staleTime: Infinity,
    gcTime:    60 * 60 * 1000,
    placeholderData: prev => prev,
    refetchOnWindowFocus: false,
    refetchOnReconnect:   false,
    refetchOnMount:       false,
  })
}
