import { useQuery } from '@tanstack/react-query'

export interface QoplaSaleRow {
  shopId: string
  restaurant: string
  sales: number
  orders: number
  currency: string
}

async function fetchQoplaSales(daysAgo: number): Promise<QoplaSaleRow[]> {
  const url = daysAgo === 1 ? '/api/qopla?date=yesterday' : '/api/qopla'
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla API fel')
  return json.sales
}

export function useQoplaSales(daysAgo = 0) {
  return useQuery({
    queryKey: ['qopla-sales', daysAgo],
    queryFn: () => fetchQoplaSales(daysAgo),
    staleTime: 5 * 60 * 1000,
    refetchInterval: daysAgo === 0 ? 5 * 60 * 1000 : false, // only auto-refresh today
  })
}
