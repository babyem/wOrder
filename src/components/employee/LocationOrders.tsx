import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Clock, CheckCircle } from 'lucide-react'
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

function OrderCard({ order }: { order: OrderWithDetails }) {
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-white shadow-sm overflow-hidden flex flex-col transition-opacity ${!isPending ? 'opacity-50' : ''}`}
    >
      {/* Status bar */}
      <div className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold ${isPending ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
        {isPending ? <Clock size={9} /> : <CheckCircle size={9} />}
        {isPending ? 'Pending' : 'Done'}
        <span className="ml-auto font-normal opacity-70 tabular-nums">{time}</span>
      </div>

      {/* Employee */}
      <div className="px-3 pt-2 pb-1">
        <p className="font-semibold text-slate-800 text-sm truncate">{order.employee?.name ?? 'Unknown'}</p>
      </div>

      {/* Products by vendor */}
      <div className="px-3 pb-3 space-y-2 flex-1">
        {[...byVendor.entries()].map(([vendor, items]) => (
          <div key={vendor}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">{vendor}</p>
            <div className="space-y-0.5">
              {items.map(item => (
                <div key={item.id} className="flex items-baseline justify-between gap-1 text-xs">
                  <span className="text-slate-700 truncate">{item.product?.name ?? '?'}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    {item.quantity} {item.unit_override ?? item.product?.unit ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {order.note && (
          <p className="text-[10px] text-slate-400 italic border-t border-slate-50 pt-1">📝 {order.note}</p>
        )}
      </div>
    </motion.div>
  )
}

export default function LocationOrders({ locationId }: { locationId: string }) {
  const { data: orders, isLoading } = useLocationOrders(locationId)

  if (isLoading || !orders?.length) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">Recent Orders</p>

      {/* Mobile: horizontal scroll showing 2.5 cards. Desktop: 4-column grid */}
      <div className="relative">
        <div
          className="no-scrollbar flex md:grid md:grid-cols-4 gap-2 overflow-x-auto md:overflow-x-visible"
          style={{ scrollbarWidth: 'none' }}
        >
          {orders.map(order => (
            <div key={order.id} className="w-[42vw] shrink-0 md:w-auto md:shrink">
              <OrderCard order={order} />
            </div>
          ))}
        </div>

        {/* Right fade — mobile only */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-slate-50 to-transparent md:hidden" />
      </div>
    </div>
  )
}
