import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Location, Employee } from '../types'

export function useAdminLocations() {
  return useQuery({
    queryKey: ['admin', 'locations'],
    queryFn: async (): Promise<Location[]> => {
      const { data, error } = await supabase.from('locations').select('*').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useAdminEmployees() {
  return useQuery({
    queryKey: ['admin', 'employees'],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase.from('employees').select('*, location:locations(name)').order('name')
      if (error) throw error
      return data
    },
  })
}

export function useCreateLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      // Create the location
      const { data, error } = await supabase.from('locations').insert({ name }).select().single()
      if (error) throw error

      // Fetch all active products and hide them all for this new location by default
      const { data: products } = await supabase.from('products').select('id').eq('active', true)
      if (products && products.length > 0) {
        await supabase.from('product_locations').insert(
          products.map(p => ({ product_id: p.id, location_id: data.id }))
        )
      }

      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      qc.invalidateQueries({ queryKey: ['admin', 'locations'] })
      qc.invalidateQueries({ queryKey: ['product_locations_all'] })
    },
  })
}

export function useCreateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (employee: { name: string; location_id: string }) => {
      const { data, error } = await supabase.from('employees').insert({ ...employee, active: true }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] })
    },
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Employee> & { id: string }) => {
      const { data, error } = await supabase.from('employees').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] })
    },
  })
}

export function useDeleteEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['admin', 'employees'] })
    },
  })
}

export function useDeleteLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('locations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      qc.invalidateQueries({ queryKey: ['admin', 'locations'] })
    },
  })
}
