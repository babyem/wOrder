import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import type { Location } from '../types'

export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: async (): Promise<Location[]> => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('sort_order')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

export function useReorderLocations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const results = await Promise.all(
        orderedIds.map((id, idx) =>
          supabase.from('locations').update({ sort_order: idx }).eq('id', id).select('id')
        )
      )
      const failed = results.find(r => r.error)
      if (failed?.error) throw failed.error
      // RLS can silently update 0 rows — treat that as a failure so the UI rolls back
      if (results.some(r => !r.data?.length)) {
        throw new Error('Kunde inte spara ordningen (behörighet saknas?)')
      }
    },
    onMutate: async (orderedIds: string[]) => {
      await qc.cancelQueries({ queryKey: ['locations'] })
      const prev = qc.getQueryData<Location[]>(['locations'])
      if (prev) {
        const pos = Object.fromEntries(orderedIds.map((id, idx) => [id, idx]))
        qc.setQueryData<Location[]>(['locations'],
          [...prev]
            .map(l => ({ ...l, sort_order: pos[l.id] ?? l.sort_order }))
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
        )
      }
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['locations'], ctx.prev)
      toast.error(e instanceof Error ? e.message : 'Kunde inte spara ordningen')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
    },
  })
}
