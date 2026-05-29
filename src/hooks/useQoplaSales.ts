import { useQuery } from '@tanstack/react-query'

export interface RestaurantSale {
  shopId: string
  restaurant: string
  sales: number
  orders: number
  currency: string
}

async function fetchQoplaSales(): Promise<RestaurantSale[]> {
  const res = await fetch('/api/qopla')
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla API fel')
  return json.sales
}

export function useQoplaSales() {
  return useQuery({
    queryKey: ['qopla-sales'],
    queryFn: fetchQoplaSales,
    staleTime: 5 * 60 * 1000,   // Återhämta var 5:e minut
    refetchInterval: 5 * 60 * 1000,
  })
}
