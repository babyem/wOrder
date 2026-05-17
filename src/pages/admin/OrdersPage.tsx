import { useState, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, RefreshCw, GitMerge, Bell, X, Mail, Phone, GripVertical, Loader2, ShoppingBag } from 'lucide-react'
import { useOrders, useMergeOrders } from '../../hooks/useOrders'
import { useLocations } from '../../hooks/useLocations'
import { useVendors } from '../../hooks/useMetadata'
import OrderCard from '../../components/admin/OrderCard'
import Spinner from '../../components/ui/Spinner'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { OrderWithDetails } from '../../types'
import { sendEmail } from '../../lib/sendEmail'
import type { Location } from '../../types/database'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function SortableColumn({
  loc,
  count,
  children,
}: {
  loc: Location
  count: number
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: loc.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="w-72 flex-none flex flex-col gap-2"
    >
      <div className="flex items-center justify-between px-1 mb-1">
        <div className="flex items-center gap-1.5">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 touch-none"
          >
            <GripVertical size={14} />
          </button>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{loc.name}</h2>
        </div>
        {count > 0 && <span className="text-xs text-slate-300 font-medium">{count}</span>}
      </div>
      {children}
    </div>
  )
}

export default function OrdersPage() {
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBatchNotify, setShowBatchNotify] = useState(false)
  const [batchSending, setBatchSending] = useState<string | null>(null)
  const [sendingChefs, setSendingChefs] = useState(false)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('orders-column-order') ?? '[]') } catch { return [] }
  })
  const qc = useQueryClient()

  const { data: orders, isLoading, refetch } = useOrders({ status, search })
  const { data: locations } = useLocations()
  const { data: vendorList } = useVendors()
  const mergeOrders = useMergeOrders()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const sortedLocations = useMemo(() => {
    if (!locations) return []
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]))
    const ordered = columnOrder.filter(id => locMap[id]).map(id => locMap[id])
    const rest = locations.filter(l => !columnOrder.includes(l.id))
    return [...ordered, ...rest]
  }, [locations, columnOrder])

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = sortedLocations.map(l => l.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setColumnOrder(newOrder)
    localStorage.setItem('orders-column-order', JSON.stringify(newOrder))
  }

  useEffect(() => {
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        qc.invalidateQueries({ queryKey: ['orders'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  // Group orders by location_id
  const ordersByLocation: Record<string, OrderWithDetails[]> = {}
  for (const order of orders ?? []) {
    const lid = order.location_id
    if (!ordersByLocation[lid]) ordersByLocation[lid] = []
    ordersByLocation[lid].push(order)
  }

  // --- Batch notify logic ---
  const vendorMap = Object.fromEntries((vendorList ?? []).map(v => [v.name, v]))
  const selectedOrders = (orders ?? []).filter(o => selected.has(o.id))
  const sameLocation = selectedOrders.length >= 2 &&
    new Set(selectedOrders.map(o => o.location_id)).size === 1

  interface VendorItem { product: string; quantity: number; unit: string }

  const vendorLocItems = new Map<string, Map<string, VendorItem[]>>()
  for (const order of selectedOrders) {
    const loc = order.location?.name ?? 'Unknown'
    for (const item of order.items) {
      const vendor = item.product?.vendor
      if (!vendor) continue
      if (!vendorLocItems.has(vendor)) vendorLocItems.set(vendor, new Map())
      const locMap = vendorLocItems.get(vendor)!
      const list = locMap.get(loc) ?? []
      const displayName = item.product?.vendor_name ?? item.product?.name ?? '?'
      const existing = list.find(e => e.product === displayName)
      if (existing) existing.quantity += item.quantity
      else list.push({ product: displayName, quantity: item.quantity, unit: item.product?.unit ?? '' })
      locMap.set(loc, list)
    }
  }

  const batchNotifiableVendors = Array.from(vendorLocItems.entries())
    .map(([name, locMap]) => {
      const meta = vendorMap[name]
      const locations = Array.from(locMap.entries()).map(([loc, items]) => ({ loc, items }))
      return { name, email: meta?.email, phone: meta?.phone, locations }
    })
    .filter(v => v.email || v.phone)

  const buildBatchBody = (vendor: typeof batchNotifiableVendors[0]) =>
    vendor.locations
      .map(({ loc, items }) => `${loc}\n${items.map(i => `${i.product}: ${i.quantity} ${i.unit}`).join('\n')}`)
      .join('\n\n')

  const handleMerge = async () => {
    const toMerge = selectedOrders as OrderWithDetails[]
    if (toMerge.length < 2) return
    try {
      await mergeOrders.mutateAsync(toMerge)
      toast.success(`${toMerge.length} orders merged`)
      clearSelection()
    } catch {
      toast.error('Failed to merge orders')
    }
  }

  const handleSendToChefsCulinar = async () => {
    const webhookUrl = import.meta.env.VITE_N8N_CHEFSCULINAR_WEBHOOK
    if (!webhookUrl) { toast.error('Webhook URL saknas — sätt VITE_N8N_CHEFSCULINAR_WEBHOOK i .env'); return }

    const pendingOrders = (orders ?? []).filter(o => o.status === 'pending')
    const aggregated = new Map<string, { quantity: number; unit: string; unit_qty: number }>()
    for (const order of pendingOrders) {
      for (const item of order.items) {
        const id = item.product?.chefsculinar_id
        if (!id) continue
        const existing = aggregated.get(id)
        if (existing) existing.quantity += item.quantity
        else aggregated.set(id, { quantity: item.quantity, unit: item.product?.chefsculinar_unit ?? 'st', unit_qty: item.product?.chefsculinar_unit_qty ?? 1 } as { quantity: number; unit: string; unit_qty: number })
      }
    }

    if (aggregated.size === 0) { toast.error('Inga produkter med ChefsCulinar-artikelnummer hittades'); return }

    const products = Array.from(aggregated.entries()).map(([chefsculinar_id, { quantity, unit, unit_qty }]) => ({
      chefsculinar_id, quantity, unit, unit_qty,
    }))

    setSendingChefs(true)
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(`${products.length} produkter skickade till ChefsCulinar`)
    } catch (err) {
      toast.error(`Misslyckades: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingChefs(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full pb-20">
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-48 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
        </select>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-700"
        >
          <RefreshCw size={17} />
        </button>
        <button
          onClick={handleSendToChefsCulinar}
          disabled={sendingChefs}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {sendingChefs ? <Loader2 size={15} className="animate-spin" /> : <ShoppingBag size={15} />}
          Skicka till ChefsCulinar
        </button>
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={32} /></div>
      ) : (
        <div className="overflow-x-auto -mx-4 md:-mx-6 px-4 md:px-6">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
            <SortableContext items={sortedLocations.map(l => l.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex gap-4 pb-4" style={{ minWidth: 'max-content' }}>
                {sortedLocations.map(loc => {
                  const colOrders = ordersByLocation[loc.id] ?? []
                  return (
                    <SortableColumn key={loc.id} loc={loc} count={colOrders.length}>
                      <AnimatePresence mode="popLayout">
                        {colOrders.length === 0 ? (
                          <div className="rounded-2xl border-2 border-dashed border-slate-100 h-20 flex items-center justify-center">
                            <span className="text-xs text-slate-300">No orders</span>
                          </div>
                        ) : (
                          colOrders.map(order => (
                            <OrderCard
                              key={order.id}
                              order={order}
                              selected={selected.has(order.id)}
                              onToggle={() => toggleSelect(order.id)}
                            />
                          ))
                        )}
                      </AnimatePresence>
                    </SortableColumn>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Floating action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
            className="fixed bottom-4 left-4 right-4 max-w-lg mx-auto bg-slate-900 rounded-2xl px-4 py-3 flex items-center gap-2 shadow-2xl z-40"
          >
            <span className="text-white text-sm font-medium flex-1">{selected.size} selected</span>
            {batchNotifiableVendors.length > 0 && (
              <button
                onClick={() => setShowBatchNotify(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
              >
                <Bell size={13} /> Notify
              </button>
            )}
            {sameLocation && (
              <button
                onClick={handleMerge}
                disabled={mergeOrders.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-slate-900 text-xs font-medium hover:bg-slate-100 disabled:opacity-50 transition-colors"
              >
                <GitMerge size={13} /> Merge
              </button>
            )}
            <button onClick={clearSelection} className="p-1.5 rounded-xl text-slate-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch notify modal */}
      <AnimatePresence>
        {showBatchNotify && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowBatchNotify(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900">Notify vendors</p>
                  <p className="text-xs text-slate-400 mt-0.5">{selected.size} orders combined</p>
                </div>
                <button onClick={() => setShowBatchNotify(false)} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                  <X size={16} className="text-slate-400" />
                </button>
              </div>
              <div className="space-y-2">
                {batchNotifiableVendors.map(v => (
                  <div key={v.name} className="border border-slate-100 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-medium text-slate-800">{v.name}</p>
                    <div className="text-xs text-slate-400 space-y-2">
                      {v.locations.map(({ loc, items }) => (
                        <div key={loc}>
                          <p className="font-medium text-slate-500">{loc}</p>
                          {items.map(i => (
                            <p key={i.product}>{i.product}: {i.quantity} {i.unit}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      {v.email && (
                        <button
                          disabled={batchSending === v.name}
                          onClick={async () => {
                            setBatchSending(v.name)
                            try {
                              await sendEmail(v.email!, `Order – ${v.name}`, buildBatchBody(v))
                              toast.success(`Email sent to ${v.name}`)
                            } catch (err) {
                              toast.error(`${v.name}: ${err instanceof Error ? err.message : 'Failed to send'}`)
                            } finally {
                              setBatchSending(null)
                            }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                        >
                          {batchSending === v.name
                            ? <Loader2 size={11} className="animate-spin" />
                            : <Mail size={11} />}
                          Email
                        </button>
                      )}
                      {v.phone && (
                        <a
                          href={`sms:${v.phone}?body=${encodeURIComponent(buildBatchBody(v))}`}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors"
                        >
                          <Phone size={11} /> SMS
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
