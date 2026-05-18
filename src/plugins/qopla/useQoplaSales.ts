import { useQuery } from '@tanstack/react-query'

async function fetchQoplaSales() {
  const res = await fetch('/api/qopla')
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Qopla API fel')
  return json.sales
}

export function useQoplaSales() {
  return useQuery({
    queryKey: ['qopla-sales'],
    queryFn: fetchQoplaSales,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })
}
