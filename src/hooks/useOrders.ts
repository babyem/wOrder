import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import type { OrderWithDetails, CartItem } from '../types'

export function useOrders(filters?: { locationId?: string; status?: string; search?: string }) {
  return useQuery({
    queryKey: ['orders', filters],
    queryFn: async (): Promise<OrderWithDetails[]> => {
      let query = supabase
        .from('orders')
        .select(`
          *,
          location:locations(*),
          employee:employees(*),
          items:order_items(*, product:products(*))
        `)
        .order('created_at', { ascending: false })

      if (filters?.locationId) {
        query = query.eq('location_id', filters.locationId)
      }
      if (filters?.status && filters.status !== 'all') {
        query = query.eq('status', filters.status)
      }

      const { data, error } = await query
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

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'pending' | 'done' }) => {
      const updates: Record<string, unknown> = { status }
      if (status === 'done') updates.completed_at = new Date().toISOString()
      if (status === 'pending') updates.completed_at = null
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

export function useDeleteOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('orders').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}

export function useMergeOrders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (orders: OrderWithDetails[]) => {
      const base = orders[0]

      // Sum quantities per product across all orders
      const merged = new Map<string, number>()
      for (const order of orders) {
        for (const item of order.items) {
          merged.set(item.product_id, (merged.get(item.product_id) ?? 0) + item.quantity)
        }
      }

      const notes = orders.map(o => o.note).filter(Boolean)

      // Try with is_merged flag; fall back without it if column doesn't exist yet (migration 010)
      let newOrderResult = await supabase
        .from('orders')
        .insert({ location_id: base.location_id, employee_id: base.employee_id, status: 'pending', note: notes.length ? notes.join(' | ') : null, is_merged: true })
        .select().single()
      if (newOrderResult.error?.message?.includes('is_merged')) {
        newOrderResult = await supabase
          .from('orders')
          .insert({ location_id: base.location_id, employee_id: base.employee_id, status: 'pending', note: notes.length ? notes.join(' | ') : null })
          .select().single()
      }
      if (newOrderResult.error) throw newOrderResult.error
      const newOrder = newOrderResult.data

      const { error: itemsErr } = await supabase.from('order_items').insert(
        Array.from(merged.entries()).map(([product_id, quantity]) => ({
          order_id: newOrder.id,
          product_id,
          quantity,
        }))
      )
      if (itemsErr) throw itemsErr

      // Delete originals — items first in case no cascade
      const ids = orders.map(o => o.id)
      await supabase.from('order_items').delete().in('order_id', ids)
      await supabase.from('orders').delete().in('id', ids)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  })
}
