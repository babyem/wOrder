import { useState, useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, RefreshCw, GitMerge, Bell, X, Mail, GripVertical, Loader2, ZoomIn, ZoomOut, Trash2, Undo2, Ban } from 'lucide-react'
import { useOrders, useMergeOrders, useMergeVendorCards, useDeletedOrders, useRestoreOrder } from '../../hooks/useOrders'
import { useLocations, useReorderLocations } from '../../hooks/useLocations'
import { useVendors } from '../../hooks/useMetadata'
import OrderCard from '../../components/admin/OrderCard'
import SmsLink from '../../components/admin/SmsLink'
import Spinner from '../../components/ui/Spinner'
import Modal from '../../components/ui/Modal'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { OrderWithDetails } from '../../types'
import { sendEmail } from '../../lib/sendEmail'
import { buildExpressData, expressOrderCount, mergeExpressLocations, type VendorItem } from '../../lib/express'
import type { Location } from '../../types/database'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, horizontalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const formatStamp = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '–'

function SortableColumn({
  loc,
  count,
  pendingCount,
  children,
}: {
  loc: Location
  count: number
  pendingCount: number
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: loc.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      id={`order-col-${loc.id}`}
      className="w-[calc(100vw-2rem)] snap-start md:w-64 flex-none flex flex-col gap-2 max-md:h-full max-md:overflow-y-auto max-md:overscroll-y-contain no-scrollbar"
    >
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-zinc-800 flex items-center justify-between px-1 py-1 -my-1 mb-0">
        <div className="flex items-center gap-1.5">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-slate-300 dark:text-zinc-600 hover:text-slate-400 dark:hover:text-zinc-500 touch-none"
          >
            <GripVertical size={14} />
          </button>
          <h2 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">{loc.name}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {pendingCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums">{pendingCount}</span>
          )}
          {count > 0 && <span className="text-xs text-slate-300 dark:text-zinc-600 font-medium">{count}</span>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function OrdersPage() {
  const [status, setStatus] = useState('all')
  const [mobileCol, setMobileCol] = useState(0)
  const [search, setSearch] = useState('')
  const [daysBack, setDaysBack] = useState(8)
  // Selection key: "orderId::vendor"
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBatchNotify, setShowBatchNotify] = useState(false)
  const [showMergePicker, setShowMergePicker] = useState(false)
  const [showVendorMergePicker, setShowVendorMergePicker] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [batchSending, setBatchSending] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number>(() => {
    const raw = parseFloat(localStorage.getItem('orders-zoom') ?? '1')
    return Number.isFinite(raw) && raw >= 0.5 && raw <= 1.5 ? raw : 1
  })
  const qc = useQueryClient()

  const ZOOM_MIN = 0.5
  const ZOOM_MAX = 1.5
  const ZOOM_STEP = 0.1
  const setZoomPersist = (z: number) => {
    const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))
    setZoom(clamped)
    localStorage.setItem('orders-zoom', String(clamped))
  }

  const fromDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - daysBack)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [daysBack])
  const { data: orders, isLoading, refetch } = useOrders({ status, search, fromDate })
  const { data: locations } = useLocations()
  const { data: vendorList } = useVendors()
  const mergeOrders = useMergeOrders()
  const mergeVendorCards = useMergeVendorCards()
  const reorderLocations = useReorderLocations()
  const { data: deletedOrders, isLoading: trashLoading, error: trashError } = useDeletedOrders(showTrash)
  const restoreOrder = useRestoreOrder()


  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const sortedLocations = locations ?? []

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = sortedLocations.map(l => l.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    reorderLocations.mutate(newOrder)
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

  const toggleSelect = (orderId: string, vendor: string) => {
    const key = `${orderId}::${vendor}`
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  // Parse selected keys into { orderId, vendor } pairs
  const selectedPairs = [...selected].map(k => {
    const idx = k.indexOf('::')
    return { orderId: k.slice(0, idx), vendor: k.slice(idx + 2) }
  })
  const selectedOrderIds = new Set(selectedPairs.map(p => p.orderId))

  // Group orders by location_id
  const ordersByLocation: Record<string, OrderWithDetails[]> = {}
  for (const order of orders ?? []) {
    const lid = order.location_id
    if (!ordersByLocation[lid]) ordersByLocation[lid] = []
    ordersByLocation[lid].push(order)
  }
  // Pending on top, then finished — newest first inside each group
  const statusRank = (o: OrderWithDetails) => (o.status === 'pending' ? 0 : 1)
  for (const list of Object.values(ordersByLocation)) {
    list.sort((a, b) => statusRank(a) - statusRank(b) || b.created_at.localeCompare(a.created_at))
  }

  // --- Batch notify logic ---
  const vendorMap = Object.fromEntries((vendorList ?? []).map(v => [v.name, v]))
  const selectedOrders = (orders ?? []).filter(o => selectedOrderIds.has(o.id))
  const canMerge = selectedOrders.length >= 2
  // Flera leverantörskort valda inom en och samma order → slå ihop korten (vendor_override)
  const vendorMergeOrder = selectedOrders.length === 1 && selectedPairs.length >= 2 ? selectedOrders[0] : null
  const vendorMergeVendors = vendorMergeOrder ? selectedPairs.map(p => p.vendor) : []
  const sameLocation = canMerge &&
    new Set(selectedOrders.map(o => o.location_id)).size === 1
  // Unique locations among selected orders (for cross-location merge target picker)
  const selectedLocations = [...new Map(
    selectedOrders.map(o => [o.location_id, o.location?.name ?? 'Unknown'])
  ).entries()].map(([id, name]) => ({ id, name }))

  // Only include items from selected vendor cards (not the whole order)
  const vendorLocItems = new Map<string, Map<string, VendorItem[]>>()
  for (const { orderId, vendor: selVendor } of selectedPairs) {
    const order = (orders ?? []).find(o => o.id === orderId)
    if (!order) continue
    const loc = order.location?.name ?? 'Unknown'
    for (const item of order.items) {
      const itemVendor = item.vendor_override ?? item.product?.vendor
      if (itemVendor !== selVendor) continue
      if (!vendorLocItems.has(selVendor)) vendorLocItems.set(selVendor, new Map())
      const locMap = vendorLocItems.get(selVendor)!
      const list = locMap.get(loc) ?? []
      const displayName = item.product?.vendor_name ?? item.product?.name ?? '?'
      // Use || (not ??) so empty-string unit_override falls through to product.unit
      const unit = item.unit_override || item.product?.unit || ''
      const existing = list.find(e => e.product === displayName)
      if (existing) {
        existing.quantity += item.quantity
        // Fill in unit if first occurrence had none
        if (!existing.unit && unit) existing.unit = unit
      } else {
        const artnr = item.product?.tingstad_id || item.product?.tingstad_alt_id || undefined
        list.push({ product: displayName, quantity: item.quantity, unit, artnr })
      }
      locMap.set(loc, list)
    }
  }

  // After notifying a vendor, persist done_vendors to the DB for every affected order
  // and auto-complete orders where all vendors are now done.
  const markVendorDoneAcrossOrders = async (vendorName: string, orderIds?: string[]) => {
    const affectedOrderIds = orderIds ?? selectedPairs
      .filter(p => p.vendor === vendorName)
      .map(p => p.orderId)

    const now = new Date().toISOString()

    await Promise.all(
      affectedOrderIds.map(async (orderId) => {
        const order = (orders ?? []).find(o => o.id === orderId)
        if (!order || order.status !== 'pending') return

        // All actual vendors in this order
        const allVendors = [
          ...new Set(order.items.map(i => i.vendor_override ?? i.product?.vendor).filter(Boolean))
        ] as string[]

        // Merge with whatever is already done on the server
        const doneSet = new Set(order.done_vendors ?? [])
        doneSet.add(vendorName)
        const doneArray = [...doneSet]
        const allDone = allVendors.every(v => doneSet.has(v))

        // One DB call: update done_vendors and, if fully done, flip status too
        await supabase.from('orders').update(
          allDone
            ? { done_vendors: doneArray, status: 'done', completed_at: now }
            : { done_vendors: doneArray }
        ).eq('id', orderId)
      })
    )

    qc.invalidateQueries({ queryKey: ['orders'] })
  }

  // ── Express: alla väntande varor per leverantör, över samtliga pending-orders ──
  // Logiken ligger i src/lib/express.ts (testad i src/lib/__tests__/express.test.ts)
  const [expressSending, setExpressSending] = useState<string | null>(null)
  const expressData = useMemo(() => buildExpressData(orders ?? []), [orders])

  // Same restaurant order as the kanban columns
  const locationRank = Object.fromEntries(sortedLocations.map((l, i) => [l.name, i]))
  const expressVendors = [...expressData.itemsByVendor.entries()]
    .filter(([name]) => vendorMap[name]?.email || vendorMap[name]?.phone)
    .map(([name, rawLocMap]) => {
      const locMap = mergeExpressLocations(name, rawLocMap)
      return {
        name,
        email: vendorMap[name]?.email ?? undefined,
        phone: vendorMap[name]?.phone ?? undefined,
        // Antal ordercard (inte artiklar) som går med i utskicket
        orderCount: expressOrderCount(expressData, name),
        locations: [...locMap.entries()]
          .map(([loc, items]) => ({ loc, items }))
          .sort((a, b) => (locationRank[a.loc] ?? 999) - (locationRank[b.loc] ?? 999)),
        // Visas bara i modalen som info till backoffice — går inte med i meddelandet
        noOrderLocations: [...(expressData.noOrderByVendor.get(name) ?? [])]
          .sort((a, b) => (locationRank[a] ?? 999) - (locationRank[b] ?? 999)),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // Håll bara namnet i state och slå upp vendorn live — annars visar en öppen
  // modal gammal data när ordrarna (eller koden) uppdateras under tiden.
  const [expressModalVendor, setExpressModalVendor] = useState<string | null>(null)
  const expressModal = expressVendors.find(v => v.name === expressModalVendor) ?? null

  const handleExpress = async (vendor: typeof expressVendors[0]) => {
    if (!vendor.email) return
    setExpressSending(vendor.name)
    try {
      const body = buildBatchBody({ name: vendor.name, email: vendor.email, phone: vendor.phone, locations: vendor.locations })
      await sendEmail(vendor.email, `Order – ${vendor.name}`, body)
      toast.success(`Email skickat till ${vendor.name}`)
      await markVendorDoneAcrossOrders(vendor.name, [...(expressData.orderIdsByVendor.get(vendor.name) ?? [])])
      setExpressModalVendor(null)
    } catch (err) {
      toast.error(`${vendor.name}: ${err instanceof Error ? err.message : 'Failed to send'}`)
    } finally {
      setExpressSending(null)
    }
  }

  const batchNotifiableVendors = Array.from(vendorLocItems.entries())
    .map(([name, locMap]) => {
      const meta = vendorMap[name]
      const locations = Array.from(locMap.entries()).map(([loc, items]) => ({ loc, items }))
      return { name, email: meta?.email, phone: meta?.phone, locations }
    })
    .filter(v => v.email || v.phone)

  const buildBatchBody = (vendor: typeof batchNotifiableVendors[0]) => {
    const hideUnit = vendorMap[vendor.name]?.hide_unit ?? false
    const isTingstad = vendor.name.toLowerCase().includes('tingstad')
    return vendor.locations
      .map(({ loc, items }) =>
        `${loc}\n${items.map(i => {
          const prefix = isTingstad && i.artnr ? `${i.artnr} — ` : ''
          return hideUnit ? `${prefix}${i.product}: ${i.quantity}` : `${prefix}${i.product}: ${i.quantity} ${i.unit}`.trimEnd()
        }).join('\n')}`
      )
      .join('\n\n')
  }

  const handleRestore = async (id: string) => {
    try {
      await restoreOrder.mutateAsync(id)
      toast.success('Order återställd')
    } catch {
      // useRestoreOrder already toasts the error
    }
  }

  const handleMerge = async (targetLocationId?: string) => {
    const toMerge = selectedOrders as OrderWithDetails[]
    if (toMerge.length < 2) return
    try {
      await mergeOrders.mutateAsync({ orders: toMerge, targetLocationId })
      toast.success(`${toMerge.length} orders merged`)
      setShowMergePicker(false)
      clearSelection()
    } catch {
      toast.error('Failed to merge orders')
    }
  }

  const handleVendorMerge = async (targetVendor: string) => {
    if (!vendorMergeOrder) return
    try {
      await mergeVendorCards.mutateAsync({ order: vendorMergeOrder, vendors: vendorMergeVendors, targetVendor })
      toast.success(`Kort sammanslagna till ${targetVendor}`)
      setShowVendorMergePicker(false)
      clearSelection()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kunde inte slå ihop korten')
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full pb-20">
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="basis-full md:basis-auto md:flex-1 relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-zinc-900"
          />
        </div>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="flex-1 md:flex-none px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm text-slate-700 dark:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-zinc-900"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="done">Done</option>
          <option value="stopped">Stoppad</option>
        </select>
        <div className="hidden md:flex items-center gap-0.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-1 py-1">
          <button
            onClick={() => setZoomPersist(zoom - ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN + 0.001}
            title="Zoom out"
            className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-700 dark:hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomOut size={15} />
          </button>
          <button
            onClick={() => setZoomPersist(1)}
            title="Reset zoom"
            className="px-1.5 text-xs tabular-nums font-medium text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 min-w-[40px]"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoomPersist(zoom + ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX - 0.001}
            title="Zoom in"
            className="p-1.5 rounded-lg text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 hover:text-slate-700 dark:hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomIn size={15} />
          </button>
        </div>
        <button
          onClick={() => setShowTrash(true)}
          title="Borttagna ordrar"
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200"
        >
          <Trash2 size={17} />
        </button>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      {/* Express — skicka alla väntande varor per leverantör */}
      {expressVendors.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">Express</span>
          {expressVendors.map(v => (
            <button
              key={v.name}
              onClick={() => setExpressModalVendor(v.name)}
              disabled={expressSending !== null}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-xs font-medium text-slate-700 dark:text-zinc-200 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50 transition-colors"
            >
              {expressSending === v.name ? <Loader2 size={12} className="animate-spin" /> : <span>⚡</span>}
              {v.name}
              <span className="text-slate-400 dark:text-zinc-500 tabular-nums">{v.orderCount}</span>
            </button>
          ))}
        </div>
      )}

      {/* Kanban board */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={32} /></div>
      ) : (
        <>
        {/* Mobile: location tabs — one column fills the screen, tap or swipe between them */}
        <div className="md:hidden -mx-4 px-4 flex gap-1.5 overflow-x-auto no-scrollbar">
          {sortedLocations.map((loc, i) => {
            const pend = (ordersByLocation[loc.id] ?? []).filter(o => o.status === 'pending').length
            const active = i === mobileCol
            return (
              <button
                key={loc.id}
                onClick={() => {
                  setMobileCol(i)
                  document.getElementById(`order-col-${loc.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
                }}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${active ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-300'}`}
              >
                {loc.name}
                {pend > 0 && <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold tabular-nums flex items-center justify-center ${active ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>{pend}</span>}
              </button>
            )
          })}
        </div>
        <div
          /* Mobile: only horizontal here, each column scrolls vertically — separate scrollers let the browser lock the gesture to one axis */
          className="no-scrollbar overflow-x-auto md:overflow-y-auto max-md:overflow-y-hidden max-md:h-[calc(100vh-190px)] max-md:overscroll-x-contain -mx-4 md:-mx-6 px-4 md:px-6 snap-x snap-mandatory md:snap-none scroll-px-4"
          style={{ zoom, maxHeight: `calc((100vh - 150px) / ${zoom})` }}
          onScroll={e => {
            if (window.innerWidth >= 768) return
            const el = e.currentTarget
            const idx = Math.round(el.scrollLeft / (el.clientWidth - 16))
            if (idx !== mobileCol) setMobileCol(idx)
          }}
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
            <SortableContext items={sortedLocations.map(l => l.id)} strategy={horizontalListSortingStrategy}>
              <div className="flex gap-4 pb-4 max-md:h-full max-md:pb-0" style={{ minWidth: 'max-content' }}>
                {sortedLocations.map(loc => {
                  const colOrders = ordersByLocation[loc.id] ?? []
                  return (
                    <SortableColumn key={loc.id} loc={loc} count={colOrders.length} pendingCount={colOrders.filter(o => o.status === 'pending').length}>
                      <AnimatePresence mode="popLayout">
                        {colOrders.length === 0 ? (
                          <div className="rounded-2xl border-2 border-dashed border-slate-100 dark:border-zinc-800 h-20 flex items-center justify-center">
                            <span className="text-xs text-slate-300 dark:text-zinc-600">No orders</span>
                          </div>
                        ) : (
                          colOrders.map(order => {
                            const orderSelectedVendors = new Set(
                              selectedPairs.filter(p => p.orderId === order.id).map(p => p.vendor)
                            )
                            return (
                            <OrderCard
                              key={order.id}
                              order={order}
                              selectedVendors={orderSelectedVendors}
                              onToggle={(vendor) => toggleSelect(order.id, vendor)}
                              showLocation={false}
                            />
                            )
                          })
                        )}
                      </AnimatePresence>
                    </SortableColumn>
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
        </>
      )}

      {/* Load more */}
      <div className="flex justify-center pt-2 pb-4">
        <button
          onClick={() => setDaysBack(d => d + 8)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-slate-500 dark:text-zinc-400 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-700 dark:hover:text-zinc-200 transition-colors shadow-sm"
        >
          Visa fler — visar {daysBack} dagar tillbaka
        </button>
      </div>

      {/* Floating action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 260 }}
            className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 right-4 max-w-lg mx-auto bg-slate-900 dark:bg-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-2 shadow-2xl z-40"
          >
            <span className="text-white text-sm font-medium flex-1">{selected.size} vendor card{selected.size !== 1 ? 's' : ''} selected</span>
            {batchNotifiableVendors.length > 0 && (
              <button
                onClick={() => setShowBatchNotify(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
              >
                <Bell size={13} /> Notify
              </button>
            )}
            {canMerge && (
              <button
                onClick={() => sameLocation ? handleMerge() : setShowMergePicker(true)}
                disabled={mergeOrders.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs font-medium hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                <GitMerge size={13} /> Merge
              </button>
            )}
            {vendorMergeOrder && (
              <button
                onClick={() => setShowVendorMergePicker(true)}
                disabled={mergeVendorCards.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-zinc-900 text-slate-900 dark:text-zinc-100 text-xs font-medium hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                <GitMerge size={13} /> Merge
              </button>
            )}
            <button onClick={clearSelection} className="p-1.5 rounded-xl text-slate-400 dark:text-zinc-500 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papperskorg — borttagna ordrar med återställning */}
      <Modal open={showTrash} onClose={() => setShowTrash(false)} title="Borttagna ordrar" maxWidth="max-w-xl">
        {trashLoading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : trashError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{trashError instanceof Error ? trashError.message : 'Kunde inte hämta borttagna ordrar'}</p>
        ) : !deletedOrders?.length ? (
          <p className="text-sm text-slate-400 dark:text-zinc-500 py-4 text-center">Inga borttagna ordrar.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {deletedOrders.map(o => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-zinc-800 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-zinc-200 truncate">
                    {o.location?.name ?? 'Okänd butik'}
                    <span className="text-slate-400 dark:text-zinc-500 font-normal"> · {o.employee?.name ?? 'Okänd'}</span>
                  </p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 tabular-nums">
                    {o.no_order_vendor ? `Ingen ${o.no_order_vendor}-beställning` : `${o.items.length} varor`} · lagd {formatStamp(o.created_at)} · borttagen {formatStamp(o.deleted_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleRestore(o.id)}
                  disabled={restoreOrder.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 dark:bg-zinc-800 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors shrink-0"
                >
                  <Undo2 size={12} />
                  Återställ
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Merge target picker — choose which location receives the merged order */}
      <AnimatePresence>
        {showMergePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowMergePicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-5 w-80"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Vem ska få den nya ordern?</h3>
                <button onClick={() => setShowMergePicker(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <X size={15} className="text-slate-400 dark:text-zinc-500" />
                </button>
              </div>
              <div className="space-y-1.5">
                {selectedLocations.map(loc => (
                  <button
                    key={loc.id}
                    onClick={() => handleMerge(loc.id)}
                    disabled={mergeOrders.isPending}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-700 dark:text-zinc-200 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-50 transition-colors text-left"
                  >
                    <GitMerge size={14} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                    {loc.name}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vendor-card merge picker — choose which vendor card keeps the items */}
      <AnimatePresence>
        {showVendorMergePicker && vendorMergeOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowVendorMergePicker(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-5 w-80"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Vilket kort ska behålla varorna?</h3>
                <button onClick={() => setShowVendorMergePicker(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800">
                  <X size={15} className="text-slate-400 dark:text-zinc-500" />
                </button>
              </div>
              <p className="text-xs text-slate-400 dark:text-zinc-500 mb-3">Övriga valda kort flyttas till den leverantören.</p>
              <div className="space-y-1.5">
                {vendorMergeVendors.map(v => (
                  <button
                    key={v}
                    onClick={() => handleVendorMerge(v)}
                    disabled={mergeVendorCards.isPending}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-700 dark:text-zinc-200 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-50 transition-colors text-left"
                  >
                    <GitMerge size={14} className="text-indigo-500 dark:text-indigo-400 shrink-0" />
                    {v}
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Express modal — samma stil som batch notify */}
      <AnimatePresence>
        {expressModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setExpressModalVendor(null)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white dark:bg-zinc-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-3 max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-zinc-100">Express order</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">Alla väntande varor</p>
                </div>
                <button onClick={() => setExpressModalVendor(null)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
                  <X size={16} className="text-slate-400 dark:text-zinc-500" />
                </button>
              </div>
              <div className="border border-slate-100 dark:border-zinc-800 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-slate-800 dark:text-zinc-200">{expressModal.name}</p>
                <div className="text-xs text-slate-400 dark:text-zinc-500 space-y-2">
                  {expressModal.locations.map(({ loc, items }) => (
                    <div key={loc}>
                      <p className="font-medium text-slate-500 dark:text-zinc-400">{loc}</p>
                      {items.map(i => (
                        <p key={i.product}>{i.product}: {i.quantity} {i.unit}</p>
                      ))}
                    </div>
                  ))}
                </div>
                {expressModal.noOrderLocations.length > 0 && (
                  <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 dark:bg-zinc-800 px-2.5 py-2 text-xs text-slate-500 dark:text-zinc-400">
                    <Ban size={12} className="mt-0.5 shrink-0" />
                    <span>Ingen beställning idag: <span className="font-medium text-slate-700 dark:text-zinc-200">{expressModal.noOrderLocations.join(', ')}</span></span>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {expressModal.email && (
                    <button
                      disabled={expressSending === expressModal.name}
                      onClick={() => handleExpress(expressModal)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors"
                    >
                      {expressSending === expressModal.name
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Mail size={11} />}
                      Email
                    </button>
                  )}
                  {expressModal.phone && (
                    <SmsLink
                      phone={expressModal.phone}
                      body={buildBatchBody(expressModal)}
                      onSent={() => {
                        markVendorDoneAcrossOrders(
                          expressModal.name,
                          [...(expressData.orderIdsByVendor.get(expressModal.name) ?? [])],
                        )
                        setExpressModalVendor(null)
                      }}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
                    />
                  )}
                </div>
              </div>
            </motion.div>
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
              className="bg-white dark:bg-zinc-900 rounded-2xl p-5 w-full max-w-sm shadow-2xl space-y-3"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-zinc-100">Notify vendors</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{selected.size} orders combined</p>
                </div>
                <button onClick={() => setShowBatchNotify(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
                  <X size={16} className="text-slate-400 dark:text-zinc-500" />
                </button>
              </div>
              <div className="space-y-2">
                {batchNotifiableVendors.map(v => (
                  <div key={v.name} className="border border-slate-100 dark:border-zinc-800 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-medium text-slate-800 dark:text-zinc-200">{v.name}</p>
                    <div className="text-xs text-slate-400 dark:text-zinc-500 space-y-2">
                      {v.locations.map(({ loc, items }) => (
                        <div key={loc}>
                          <p className="font-medium text-slate-500 dark:text-zinc-400">{loc}</p>
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
                              await markVendorDoneAcrossOrders(v.name)
                              setShowBatchNotify(false)
                              clearSelection()
                            } catch (err) {
                              toast.error(`${v.name}: ${err instanceof Error ? err.message : 'Failed to send'}`)
                            } finally {
                              setBatchSending(null)
                            }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors"
                        >
                          {batchSending === v.name
                            ? <Loader2 size={11} className="animate-spin" />
                            : <Mail size={11} />}
                          Email
                        </button>
                      )}
                      {v.phone && (
                        <SmsLink
                          phone={v.phone}
                          body={buildBatchBody(v)}
                          onSent={() => { markVendorDoneAcrossOrders(v.name); setShowBatchNotify(false); clearSelection() }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors"
                        />
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
