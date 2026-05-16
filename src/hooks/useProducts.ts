import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'

export function useProducts(activeOnly = false, locationId?: string) {
  return useQuery({
    queryKey: ['products', activeOnly, locationId],
    queryFn: async (): Promise<Product[]> => {
      // Try with product_locations join; fall back to plain select if table doesn't exist yet
      let baseQuery = supabase.from('products').select('*, product_locations(location_id)').order('sort_order')
      if (activeOnly) baseQuery = baseQuery.eq('active', true)
      const { data, error } = await baseQuery

      if (error) {
        // product_locations table missing — fall back to plain query
        let fallback = supabase.from('products').select('*').order('sort_order')
        if (activeOnly) fallback = fallback.eq('active', true)
        const { data: d2, error: e2 } = await fallback
        if (e2) throw e2
        return d2 as Product[]
      }

      if (!locationId) return data as Product[]

      return (data as (Product & { product_locations: { location_id: string }[] })[]).filter(p => {
        const locs = p.product_locations ?? []
        return locs.length === 0 || !locs.some(l => l.location_id === locationId)
      })
    },
  })
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (product: Omit<Product, 'id' | 'created_at' | 'chefsculinar_id' | 'chefsculinar_unit'> & { chefsculinar_id?: string | null; chefsculinar_unit?: string | null }) => {
      const { data, error } = await supabase.from('products').insert(product).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Product> & { id: string }) => {
      const { data, error } = await supabase.from('products').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  })
}
