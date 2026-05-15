import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface LocationAlarm {
  id: string
  location_id: string
  label: string
  time: string   // "HH:MM"
  days: number[] // 0=Sun, 1=Mon, …, 6=Sat
  active: boolean
  created_at: string
}

export function useLocationAlarms(locationId: string) {
  return useQuery({
    queryKey: ['location_alarms', locationId],
    queryFn: async (): Promise<LocationAlarm[]> => {
      const { data, error } = await supabase
        .from('location_alarms')
        .select('*')
        .eq('location_id', locationId)
        .order('time')
      if (error) return []
      return data
    },
    enabled: !!locationId,
  })
}

export function useAllActiveAlarms() {
  return useQuery({
    queryKey: ['location_alarms_active'],
    queryFn: async (): Promise<(LocationAlarm & { locations: { name: string } })[]> => {
      const { data, error } = await supabase
        .from('location_alarms')
        .select('*, locations(name)')
        .eq('active', true)
      if (error) return []
      return data
    },
    refetchInterval: 60_000,
  })
}

export function useCreateAlarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (alarm: Omit<LocationAlarm, 'id' | 'created_at'>) => {
      const { data, error } = await supabase.from('location_alarms').insert(alarm).select().single()
      if (error) throw error
      return data as LocationAlarm
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['location_alarms', v.location_id] })
      qc.invalidateQueries({ queryKey: ['location_alarms_active'] })
    },
  })
}

export function useUpdateAlarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LocationAlarm> & { id: string }) => {
      const { data, error } = await supabase.from('location_alarms').update(updates).eq('id', id).select().single()
      if (error) throw error
      return data as LocationAlarm
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['location_alarms', d.location_id] })
      qc.invalidateQueries({ queryKey: ['location_alarms_active'] })
    },
  })
}

export function useDeleteAlarm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; locationId: string }) => {
      const { error } = await supabase.from('location_alarms').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, { locationId }) => {
      qc.invalidateQueries({ queryKey: ['location_alarms', locationId] })
      qc.invalidateQueries({ queryKey: ['location_alarms_active'] })
    },
  })
}
