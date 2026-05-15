import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useProductLocations(productId?: string) {
  return useQuery({
    queryKey: ['product_locations', productId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('product_locations')
        .select('location_id')
        .eq('product_id', productId!)
      if (error) return [] // graceful degradation if table doesn't exist yet
      return data.map(r => r.location_id)
    },
    enabled: !!productId,
  })
}

export function useSetProductLocations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ productId, locationIds }: { productId: string; locationIds: string[] }) => {
      // Delete existing then insert new
      const { error: delError } = await supabase
        .from('product_locations')
        .delete()
        .eq('product_id', productId)
      if (delError) throw delError

      if (locationIds.length > 0) {
        const rows = locationIds.map(location_id => ({ product_id: productId, location_id }))
        const { error: insError } = await supabase.from('product_locations').insert(rows)
        if (insError) throw insError
      }
    },
    onSuccess: (_d, { productId }) => {
      qc.invalidateQueries({ queryKey: ['product_locations', productId] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })
}

// Fetch all product_locations at once (used for filtering on the order page)
export function useAllProductLocations() {
  return useQuery({
    queryKey: ['product_locations_all'],
    queryFn: async (): Promise<{ product_id: string; location_id: string }[]> => {
      const { data, error } = await supabase.from('product_locations').select('product_id, location_id')
      if (error) throw error
      return data
    },
  })
}
