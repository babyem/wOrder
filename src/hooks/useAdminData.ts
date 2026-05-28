import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Location, EmployeeWithLocations } from '../types'

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
    queryFn: async (): Promise<EmployeeWithLocations[]> => {
      const { data, error } = await supabase
        .from('employees')
        .select('*, employee_locations(location_id, location:locations(name))')
        .order('name')
      if (error) throw error
      return data as EmployeeWithLocations[]
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
    mutationFn: async ({ name, location_ids, active }: { name: string; location_ids: string[]; active: boolean }) => {
      const { data, error } = await supabase
        .from('employees')
        .insert({ name, active })
        .select()
        .single()
      if (error) throw error

      if (location_ids.length > 0) {
        const { error: locErr } = await supabase
          .from('employee_locations')
          .insert(location_ids.map(lid => ({ employee_id: data.id, location_id: lid })))
        if (locErr) throw locErr
      }

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
    mutationFn: async ({ id, name, location_ids, active }: { id: string; name: string; location_ids: string[]; active: boolean }) => {
      const { data, error } = await supabase
        .from('employees')
        .update({ name, active })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error

      // Replace all location assignments atomically
      await supabase.from('employee_locations').delete().eq('employee_id', id)
      if (location_ids.length > 0) {
        const { error: locErr } = await supabase
          .from('employee_locations')
          .insert(location_ids.map(lid => ({ employee_id: id, location_id: lid })))
        if (locErr) throw locErr
      }

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
