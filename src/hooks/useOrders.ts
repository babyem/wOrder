import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import type { OrderWithDetails, CartItem } from '../types'
import { planMergedOrder, planVendorCardMerge } from '../lib/mergeOrders'

const MIGRATION_HINT = 'kolumnen deleted_at saknas — kör migration 027 i Supabase SQL editor'

const missingDeletedAt = (error: { message?: string; code?: string }) =>
  !!error.message?.includes('deleted_at')

export function useOrders(filters?: { locationId?: string; status?: string; search?: string; fromDate?: string }) {
  return useQuery({
    queryKey: ['orders', filters],
    queryFn: async (): Promise<OrderWithDetails[]> => {
      const build = (hideDeleted: boolean) => {
        let query = supabase
          .from('orders')
          .select(`
            *,
            location:locations(*),
            employee:employees(*),
            items:order_items(*, product:products(*))
          `)
          .order('created_at', { ascending: false })

        if (hideDeleted) {
          query = query.is('deleted_at', null)
        }
        if (filters?.locationId) {
          query = query.eq('location_id', filters.locationId)
        }
        if (filters?.status && filters.status !== 'all') {
          query = query.eq('status', filters.status)
        }
        if (filters?.fromDate) {
          query = query.gte('created_at', filters.fromDate)
        }
        return query
      }

      // Fall back to the unfiltered query if migration 027 hasn't been run yet
      let { data, error } = await build(true)
      if (error && missingDeletedAt(error)) {
        ({ data, error } = await build(false))
      }
      if (error) throw error

      let result = data as OrderWithDetails[]

      if (filters?.search) {
        const s = filters.search.toLowerCase()
        result = result.filter(o =>
          o.employee?.name.toLowerCase().includes(s) ||
          o.location?.name.toLowerCase().includes(s) ||
          o.items.some(i => i.product?.name.toLowerCase().includes(s))
        )
      }

      return result
    },
    placeholderData: keepPreviousData,
  })
}

export function useSubmitOrder() {
  return useMutation({
    mutationFn: async ({
      locationId,
      employeeId,
      note,
      items,
    }: {
      locationId: string
      employeeId: string
      note?: string
      items: CartItem[]
    }) => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({ location_id: locationId, employee_id: employeeId, note: note || null, status: 'pending' })
        .select()
        .single()
      if (orderError) throw orderError

      const orderItems = items.map(i => ({
        order_id: order.id,
        product_id: i.product_id,
        quantity: i.quantity,
      }))

      const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
      if (itemsError) throw itemsError

      return order
    },
  })
}

// "Ingen beställning" — en order utan items som talar om för backoffice att butiken
// inte beställer från leverantören idag (migration 028)
export function useSubmitNoOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ locationId, employeeId, vendor }: { locationId: string; employeeId: string; vendor: string }) => {
      const { error } = await supabase
        .from('orders')
        .insert({ location_id: locationId, employee_id: employeeId, status: 'pending', no_order_vendor: vendor })
      if (error) {
        // Unikt index per butik/leverantör/dag (migration 030)
        if (error.code === '23505') {
          throw new Error(`Backoffice har redan fått besked om ${vendor} idag`)
        }
        if (error.message?.includes('no_order_vendor')) {
          throw new Error('kolumnen no_order_vendor saknas — kör migration 028 i Supabase SQL editor')
        }
        throw error
      }
    },
    onSuccess: (_data, { locationId }) => {
      qc.invalidateQueries({ queryKey: ['location-orders', locationId] })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'pending' | 'done' | 'stopped' }) => {
      const updates: Record<string, unknown> = { status }
      // 'stopped' kräver migration 029 (check-constraint på status)
      updates.completed_at = status === 'done' ? new Date().toISOString() : null
      const { error } = await supabase.from('orders').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}

export function useUpdateOrderItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; vendor_override?: string | null; unit_override?: string | null; notify_excluded?: boolean; quantity?: number }) => {
      const { data, error } = await supabase.from('order_items').update(updates).eq('id', id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('RLS blocked the update — add an update policy for order_items')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
    onError: (err: Error) => {
      const hint = err.message.includes('column')
        ? ' — run migration 008 in Supabase SQL editor'
        : ''
      toast.error(`Save failed: ${err.message}${hint}`)
    },
  })
}

export function useMarkVendorDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, done_vendors }: { id: string; done_vendors: string[] }) => {
      const { error } = await supabase.from('orders').update({ done_vendors }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
    onError: (err: Error) => toast.error(`Save failed: ${err.message}`),
  })
}

export function useUpdateAdminNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, admin_note }: { id: string; admin_note: string | null }) => {
      const { error } = await supabase.from('orders').update({ admin_note }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}

// Soft delete — the row stays so the removal can be undone (migration 027)
export function useDeleteOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('orders').update({ deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) {
        if (missingDeletedAt(error)) throw new Error(MIGRATION_HINT)
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['deleted-orders'] })
    },
  })
}

export function useRestoreOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('orders').update({ deleted_at: null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['deleted-orders'] })
    },
    onError: (err: Error) => toast.error(`Kunde inte återställa ordern: ${err.message}`),
  })
}

// The papperskorg log — most recently removed first
export function useDeletedOrders(enabled = true) {
  return useQuery({
    queryKey: ['deleted-orders'],
    enabled,
    queryFn: async (): Promise<OrderWithDetails[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          location:locations(*),
          employee:employees(*),
          items:order_items(*, product:products(*))
        `)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
        .limit(50)
      if (error) {
        if (missingDeletedAt(error)) throw new Error(MIGRATION_HINT)
        throw error
      }
      return data as OrderWithDetails[]
    },
  })
}

export function useMergeOrders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ orders, targetLocationId }: { orders: OrderWithDetails[]; targetLocationId?: string }) => {
      // Ren beräkning i src/lib/mergeOrders.ts (testad)
      const plan = planMergedOrder(orders, targetLocationId)

      const { data: newOrder, error: orderErr } = await supabase
        .from('orders')
        .insert({ location_id: plan.locationId, employee_id: plan.employeeId, status: 'pending', note: plan.note, is_merged: true })
        .select().single()
      if (orderErr) throw orderErr

      const { error: itemsErr } = await supabase.from('order_items').insert(
        plan.items.map(i => ({ order_id: newOrder.id, ...i }))
      )
      if (itemsErr) throw itemsErr

      // Originalen soft-deletas så de kan återställas från papperskorgen.
      // Deras order_items lämnas kvar — annars är en återställd order tom.
      const ids = orders.map(o => o.id)
      const { error: delErr } = await supabase
        .from('orders')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids)
      if (delErr) throw delErr
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}

// Slår ihop leverantörskort inom samma order — sätter vendor_override på raderna.
export function useMergeVendorCards() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ order, vendors, targetVendor }: { order: OrderWithDetails; vendors: string[]; targetVendor: string }) => {
      const updates = planVendorCardMerge(order, vendors, targetVendor)
      for (const { id, vendor_override } of updates) {
        const { data, error } = await supabase.from('order_items').update({ vendor_override }).eq('id', id).select('id')
        if (error) throw error
        if (!data?.length) throw new Error('RLS blocked the update — add an update policy for order_items')
      }
      return updates.length
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}
