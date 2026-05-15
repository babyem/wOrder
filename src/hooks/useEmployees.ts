import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export function useEmployees(locationId?: string) {
  return useQuery({
    queryKey: ['employees', locationId],
    queryFn: async (): Promise<Employee[]> => {
      let query = supabase
        .from('employees')
        .select('*')
        .eq('active', true)
        .order('name')
      if (locationId) {
        query = query.eq('location_id', locationId)
      }
      const { data, error } = await query
      if (error) throw error
      return data
    },
    enabled: !!locationId,
  })
}
