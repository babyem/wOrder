import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Employee } from '../types'

export function useEmployees(locationId?: string) {
  return useQuery({
    queryKey: ['employees', locationId],
    queryFn: async (): Promise<Employee[]> => {
      const { data, error } = await supabase
        .from('employees')
        .select('*, employee_locations!inner(location_id)')
        .eq('employee_locations.location_id', locationId!)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Employee[]
    },
    enabled: !!locationId,
  })
}
