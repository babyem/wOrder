import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface MetaItem { id: string; name: string; sort_order?: number; email?: string; phone?: string; created_at: string }
type MetaTable = 'vendors' | 'categories' | 'units'

function useMetaList(table: MetaTable) {
  return useQuery({
    queryKey: [table],
    queryFn: async (): Promise<MetaItem[]> => {
      let q = supabase.from(table).select('*')
      if (table === 'vendors') q = q.order('sort_order')
      q = q.order('name')
      const { data, error } = await q
      if (error) return [] // table may not exist yet — graceful degradation
      return data
    },
  })
}

function useCreateMeta(table: MetaTable) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from(table).insert({ name }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

function useDeleteMeta(table: MetaTable) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

export function useVendors() { return useMetaList('vendors') }
export function useCreateVendor() { return useCreateMeta('vendors') }
export function useDeleteVendor() { return useDeleteMeta('vendors') }

export function useUpdateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; email?: string | null; phone?: string | null }) => {
      const { error } = await supabase.from('vendors').update(fields).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

export function useReorderVendors() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((id, idx) => supabase.from('vendors').update({ sort_order: idx }).eq('id', id))
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
  })
}

function useRenameMeta(table: MetaTable) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from(table).update({ name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [table] }),
  })
}

export function useCategories() { return useMetaList('categories') }
export function useCreateCategory() { return useCreateMeta('categories') }
export function useDeleteCategory() { return useDeleteMeta('categories') }
export function useRenameCategory() { return useRenameMeta('categories') }

export function useUnits() { return useMetaList('units') }
export function useCreateUnit() { return useCreateMeta('units') }
export function useDeleteUnit() { return useDeleteMeta('units') }
export function useRenameUnit() { return useRenameMeta('units') }

export function useRenameVendor() { return useRenameMeta('vendors') }
