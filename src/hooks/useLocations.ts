import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Location } from '../types'

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async (): Promise<Location[]> => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('name')
      if (error) throw error
      return data
    },
  })
}
