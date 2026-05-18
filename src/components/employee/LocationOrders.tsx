import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Clock, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { OrderWithDetails } from '../../types'

function useLocationOrders(locationId: string) {
  return useQuery({
    queryKey: ['location-orders', locationId],
    queryFn: async (): Promise<OrderWithDetails[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          location:locations(*),
          employee:employees(*),
          items:order_items(*, product:products(*))
        `)
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(4)
      if (error) throw error
      return data as OrderWithDetails[]
    },
    enabled: !!locationId,
    refetchInterval: 30_000,
  })
}

function OrderRow({ order }: { order: OrderWithDetails }) {
  const [expanded, setExpanded] = useState(false)
  const isPending = order.status === 'pending'

  const byVendor = new Map<string, typeof order.items>()
  for (const item of order.items) {
    const v = item.product?.vendor ?? 'Övrigt'
    byVendor.set(v, [...(byVendor.get(v) ?? []), item])
  }

  const time = new Date(order.created_at).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  return (
    <motion.div
      layout
      className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-opacity ${!isPending ? 'opacity-60' : ''}`}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${isPending ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        <span className="font-medium text-slate-800 text-sm flex-1 truncate">
          {order.employee?.name ?? 'Unknown'}
        </span>
        <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{time}</span>
        <div className={`shrink-0 ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${isPending ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {isPending ? <Clock size={9} /> : <CheckCircle size={9} />}
          {isPending ? 'Pending' : 'Done'}
        </div>
        {expanded ? <ChevronUp size={13} className="text-slate-400 shrink-0" /> : <ChevronDown size={13} className="text-slate-400 shrink-0" />}
      </button>

      {/* Expanded product list */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2 border-t border-slate-50 pt-2">
              {[...byVendor.entries()].map(([vendor, items]) => (
                <div key={vendor}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{vendor}</p>
                  <div className="space-y-0.5">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-700">{item.product?.name ?? '?'}</span>
                        <span className="text-slate-400 tabular-nums">
                          {item.quantity} {item.unit_override ?? item.product?.unit ?? ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {order.note && (
                <p className="text-[11px] text-slate-400 italic border-t border-slate-50 pt-1.5">📝 {order.note}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function LocationOrders({ locationId }: { locationId: string }) {
  const { data: orders, isLoading } = useLocationOrders(locationId)

  if (isLoading || !orders?.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">Recent Orders</p>
      {orders.map(order => (
        <OrderRow key={order.id} order={order} />
      ))}
    </div>
  )
}
