import { useState, useEffect, useRef, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, RotateCcw, Trash2, FileText, X, Bell, CheckSquare, Square, Loader2, Tag, ShoppingBag, AlertTriangle, AlertCircle, Copy, Ban, MoreHorizontal } from 'lucide-react'
import type { Order, OrderWithDetails } from '../../types'
import { useUpdateOrderStatus, useDeleteOrder, useRestoreOrder, useUpdateOrderItem, useMarkVendorDone, useUpdateAdminNote, useDeleteOrderItems } from '../../hooks/useOrders'
import { useVendors, useUnits } from '../../hooks/useMetadata'
import { sendEmail } from '../../lib/sendEmail'
import SmsLink from './SmsLink'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { confirmDialog } from '../../store/confirmStore'

interface Props {
  order: OrderWithDetails
  selectedVendors?: Set<string>   // which vendor cards of this order are selected
  onToggle?: (vendor: string) => void
  showLocation?: boolean          // false when the surrounding column is already the location
}

// Coarse pointer / no hover: phones and tablets. Double-click is unreliable there.
const isTouch = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

type DropPos = { top?: number; bottom?: number; left: number }
// Anchor a fixed-position dropdown to where the user clicked/tapped. Pointer
// coordinates are true viewport pixels even inside a CSS-zoomed container,
// unlike getBoundingClientRect (Safari returns unzoomed values there).
function dropPosFromEvent(e: React.MouseEvent, width: number, height: number): DropPos {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX || rect.right
  const y = e.clientY || rect.bottom
  const goUp = y + height + 8 > window.innerHeight
  const left = Math.max(4, Math.min(x - width / 2, window.innerWidth - width - 4))
  return goUp ? { bottom: window.innerHeight - y + 8, left } : { top: y + 8, left }
}

// forwardRef: the column's <AnimatePresence mode="popLayout"> needs a DOM ref on each card
// to pop it out of flow and run the exit animation. Without it a deleted card stayed on screen.
const OrderCard = forwardRef<HTMLDivElement, Props>(function OrderCard({ order, selectedVendors, onToggle, showLocation = true }, ref) {
  const updateStatus = useUpdateOrderStatus()
  const deleteOrder = useDeleteOrder()
  const restoreOrder = useRestoreOrder()
  const updateAdminNote = useUpdateAdminNote()
  const { data: vendorList } = useVendors()
  const updateOrderItem = useUpdateOrderItem()
  const markVendorDoneMutation = useMarkVendorDone()
  const deleteItems = useDeleteOrderItems()
  const [showNotifyVendor, setShowNotifyVendor] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const [actionsPinned, setActionsPinned] = useState(false)
  const toggleNotify = (vendor: string) => setShowNotifyVendor(prev => prev === vendor ? null : vendor)
  const [editingNote, setEditingNote] = useState(false)
  const [noteVal, setNoteVal] = useState(order.admin_note ?? '')
  const [celebrate, setCelebrate] = useState(false)

  const triggerCelebrate = () => {
    setCelebrate(true)
    setTimeout(() => setCelebrate(false), 800)
  }

  const saveNote = () => {
    const trimmed = noteVal.trim()
    const newVal = trimmed || null
    if (newVal !== order.admin_note) {
      updateAdminNote.mutate({ id: order.id, admin_note: newVal })
    }
    setEditingNote(false)
  }

  // Derived from server state — persists globally and syncs across users via Realtime
  const doneVendors = new Set(order.done_vendors ?? [])

  const markVendorDone = (vendor: string, done: boolean, allVendors?: string[]) => {
    const next = new Set(doneVendors)
    done ? next.add(vendor) : next.delete(vendor)
    markVendorDoneMutation.mutate({ id: order.id, done_vendors: [...next] })
    // Auto-complete order when every vendor is done
    if (done && allVendors && allVendors.every(v => next.has(v)) && order.status === 'pending') {
      updateStatus.mutateAsync({ id: order.id, status: 'done' })
    }
  }
  const [sending, setSending] = useState<string | null>(null)
  const [editingVendorItem, setEditingVendorItem] = useState<string | null>(null)
  const [editingQtyItem, setEditingQtyItem] = useState<string | null>(null)
  const [qtyDraft, setQtyDraft] = useState('')
  const [sendingChefs, setSendingChefs] = useState(false)
  const [sendingTingstad, setSendingTingstad] = useState(false)
  const [chefsStatus, setChefsStatus] = useState<null | 'pending' | 'failed'>(
    () => (localStorage.getItem(`chefs_status_${order.id}`) as null | 'pending' | 'failed') ?? null
  )
  const chefsOrderFailed = chefsStatus === 'failed'

  const setChefsState = (status: null | 'pending' | 'failed') => {
    setChefsStatus(status)
    if (status === null) localStorage.removeItem(`chefs_status_${order.id}`)
    else localStorage.setItem(`chefs_status_${order.id}`, status)
  }

  // Local state for instant feedback — initialised from server, persisted to DB in background
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(order.items.filter(i => i.notify_excluded).map(i => i.id))
  )
  const [vendorOverrides, setVendorOverrides] = useState<Record<string, string>>(
    () => Object.fromEntries(order.items.filter(i => i.vendor_override).map(i => [i.id, i.vendor_override!]))
  )
  const [unitOverrides, setUnitOverrides] = useState<Record<string, string>>(
    () => Object.fromEntries(order.items.filter(i => i.unit_override).map(i => [i.id, i.unit_override!]))
  )
  // Sync local override state when the server row changes (e.g. after a vendor-card merge from OrdersPage)
  useEffect(() => {
    setVendorOverrides(Object.fromEntries(order.items.filter(i => i.vendor_override).map(i => [i.id, i.vendor_override!])))
  }, [order.items])
  const [editingUnitItem, setEditingUnitItem] = useState<string | null>(null)
  const [unitDropPos, setUnitDropPos] = useState<Record<string, DropPos>>({})
  const [vendorDropPos, setVendorDropPos] = useState<Record<string, DropPos>>({})
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: unitList } = useUnits()
  const vendorMap = Object.fromEntries((vendorList ?? []).map(v => [v.name, v]))

  const effectiveVendor = (item: typeof order.items[0]) =>
    vendorOverrides[item.id] ?? item.product?.vendor ?? '—'

  const effectiveUnit = (item: typeof order.items[0]) =>
    unitOverrides[item.id] ?? item.product?.unit ?? ''

  const isExcluded = (itemId: string) => excluded.has(itemId)

  const orderVendors = [
    ...new Set(order.items.map(i => effectiveVendor(i)).filter(v => v !== '—'))
  ].map(vName => {
    const meta = vendorMap[vName]
    return { name: vName, email: meta?.email ?? null, phone: meta?.phone ?? null }
  })

  const copyVendor = (vendorName: string) => {
    const lines = order.items
      .filter(i => effectiveVendor(i) === vendorName && !isExcluded(i.id))
      .map(i => {
        const unit = effectiveUnit(i)
        return `${i.product?.name ?? '?'}: ${i.quantity}${unit ? ` ${unit}` : ''}`
      })
    const text = `${order.location?.name ?? ''}\n\n${lines.join('\n')}`
    navigator.clipboard.writeText(text)
      .then(() => toast.success(`${vendorName} kopierad`))
      .catch(() => toast.error('Kunde inte kopiera'))
  }

  const buildBody = (vendorName: string) => {
    const items = order.items.filter(i =>
      effectiveVendor(i) === vendorName && !isExcluded(i.id)
    )
    const hideUnit = vendorMap[vendorName]?.hide_unit ?? false
    const isTingstad = vendorName.toLowerCase().includes('tingstad')
    const lines = items.map(i => {
      const unit = hideUnit ? '' : ` ${effectiveUnit(i)}`
      const name = i.product?.vendor_name ?? i.product?.name ?? '?'
      const artnr = i.product?.tingstad_id || i.product?.tingstad_alt_id
      const prefix = isTingstad && artnr ? `${artnr} — ` : ''
      return `${prefix}${name}: ${i.quantity}${unit}`
    })
    return `${order.location?.name ?? ''}\n\n${lines.join('\n')}`
  }

  const toggleExclude = (item: typeof order.items[0]) => {
    const next = !excluded.has(item.id)
    setExcluded(prev => { const s = new Set(prev); next ? s.add(item.id) : s.delete(item.id); return s })
    updateOrderItem.mutate({ id: item.id, notify_excluded: next })
  }

  const setItemVendor = (item: typeof order.items[0], vendor: string) => {
    const override = vendor === item.product?.vendor ? null : vendor
    setVendorOverrides(prev => {
      const next = { ...prev }
      if (override === null) delete next[item.id]
      else next[item.id] = vendor
      return next
    })
    updateOrderItem.mutate({ id: item.id, vendor_override: override })
    setEditingVendorItem(null)
  }

  const handleComplete = async () => {
    const prevDoneVendors = order.done_vendors ?? []
    try {
      await updateStatus.mutateAsync({ id: order.id, status: 'done' })
      toast.success(t => (
        <span className="flex items-center gap-3">
          Order klar
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              await updateStatus.mutateAsync({ id: order.id, status: 'pending' })
              markVendorDoneMutation.mutate({ id: order.id, done_vendors: prevDoneVendors })
            }}
            className="px-2 py-0.5 rounded-lg bg-slate-800 dark:bg-zinc-800 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-zinc-700"
          >
            Ångra
          </button>
        </span>
      ), { duration: 5000 })
      if (orderVendors.length > 0) setShowNotifyVendor(orderVendors[0].name)
    } catch {
      toast.error('Failed to update order')
    }
  }

  const markAllVendorsDone = (allVendors: string[]) => {
    markVendorDoneMutation.mutate({ id: order.id, done_vendors: allVendors })
  }

  // Stoppa: ordern blir grå ("ingen beställning") men ligger kvar på tavlan
  const handleStop = async () => {
    try {
      await updateStatus.mutateAsync({ id: order.id, status: 'stopped' })
      toast.success(t => (
        <span className="flex items-center gap-3">
          Order stoppad — ingen beställning
          <button
            onClick={async () => {
              toast.dismiss(t.id)
              await updateStatus.mutateAsync({ id: order.id, status: 'pending' })
            }}
            className="px-2 py-0.5 rounded-lg bg-slate-800 dark:bg-zinc-800 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-zinc-700"
          >
            Ångra
          </button>
        </span>
      ), { duration: 5000 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      toast.error(msg.includes('status') ? 'Kör migration 029 i Supabase SQL editor' : 'Failed to update order')
    }
  }

  const handleReopen = async () => {
    try {
      await updateStatus.mutateAsync({ id: order.id, status: 'pending' })
      toast.success('Order reopened')
    } catch {
      toast.error('Failed to update order')
    }
  }

  // Ta bort en hel leverantörs del av en order (bara i flerleverantörsordrar)
  const removeVendor = async (vendor: string, items: typeof order.items) => {
    const ok = await confirmDialog({
      title: `Ta bort ${vendor} från ordern?`,
      message: `${items.length} rader försvinner. Går inte att ångra.`,
      confirmLabel: 'Ta bort',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteItems.mutateAsync(items.map(i => i.id))
      toast.success(`${vendor} borttagen från ordern`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteOrder.mutateAsync(order.id)
      toast.success(t => (
        <span className="flex items-center gap-3">
          Order borttagen
          <button
            onClick={() => {
              toast.dismiss(t.id)
              restoreOrder.mutate(order.id)
            }}
            className="px-2 py-0.5 rounded-lg bg-slate-800 dark:bg-zinc-800 text-white text-xs font-medium hover:bg-slate-700 dark:hover:bg-zinc-700"
          >
            Ångra
          </button>
        </span>
      ), { duration: 8000 })
    } catch (err) {
      toast.error(`Kunde inte ta bort ordern: ${err instanceof Error ? err.message : 'okänt fel'}`)
    }
  }

  const stableItems = [...order.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const isChefsVendor = (v: string) =>
    v.toLowerCase().replace(/[\s-]/g, '').includes('chefsculinar')

  // Only items whose EFFECTIVE vendor name contains "chefsculinar" — ignores overridden items
  const chefsItems = stableItems.filter(i =>
    i.product?.chefsculinar_id && isChefsVendor(effectiveVendor(i))
  )
  const chefsVendorName = chefsItems.length > 0 ? effectiveVendor(chefsItems[0]) : null

  const handleSendToChefs = async () => {
    const webhookUrl = import.meta.env.VITE_N8N_CHEFSCULINAR_WEBHOOK
    if (!webhookUrl) { toast.error('Webhook URL saknas'); return }
    if (!order.location?.chefsculinar_customer_id) {
      toast.error(`ChefsCulinar-kundnummer saknas för ${order.location?.name ?? 'butiken'} — lägg till det under Butiker`)
      return
    }
    const products = chefsItems.map(i => ({
      chefsculinar_id: i.product!.chefsculinar_id,
      quantity: i.quantity,
      unit: i.product!.chefsculinar_unit ?? 'st',
      unit_qty: i.product!.chefsculinar_unit_qty ?? 1,
    }))
    setSendingChefs(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: order.location_id,
          location_name: order.location?.name ?? '',
          customer_id: order.location?.chefsculinar_customer_id ?? null,
          products,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Check response body for error fields even on 200
      let body: unknown
      try { body = await res.clone().json() } catch { /* not JSON, ignore */ }
      if (body && typeof body === 'object' && ('error' in body || 'success' in body && !(body as Record<string, unknown>).success)) {
        throw new Error(String((body as Record<string, unknown>).error ?? 'Webhook reported failure'))
      }

      // n8n may wrap response as [{json:{...}}], [{OrderNumber,...}], or {OrderNumber,...}
      const unwrap = (v: unknown): Record<string, unknown> | null => {
        if (!v || typeof v !== 'object') return null
        const arr = Array.isArray(v) ? v[0] : v
        if (!arr || typeof arr !== 'object') return null
        const rec = arr as Record<string, unknown>
        return (rec.json && typeof rec.json === 'object') ? rec.json as Record<string, unknown> : rec
      }
      const b = unwrap(body)
      const orderNum = b?.OrderNumber
      const orderTotal = b?.Total
      if (orderNum) {
        setChefsState(null)
        if (chefsVendorName) markVendorDone(chefsVendorName, true, allVendorNames)
        toast.success(`✓ Order #${orderNum} bekräftad${orderTotal ? ` — ${orderTotal} SEK` : ''}`, { duration: 6000 })
      } else {
        setChefsState('failed')
        toast.error('Inget ordernummer — kontrollera ChefsCulinar')
      }
    } catch (err) {
      clearTimeout(timeout)
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? 'Timeout — inget svar från ChefsCulinar' : err.message)
        : String(err)
      setChefsState('failed')
      toast.error(`Misslyckades: ${msg}`)
    } finally {
      setSendingChefs(false)
    }
  }

  // ── Tingstad auto-order via n8n webhook ──
  const isTingstadVendor = (v: string) => v.toLowerCase().includes('tingstad')
  const tingstadItems = stableItems.filter(i =>
    (i.product?.tingstad_id || i.product?.tingstad_alt_id) && isTingstadVendor(effectiveVendor(i))
  )
  const tingstadVendorName = tingstadItems.length > 0 ? effectiveVendor(tingstadItems[0]) : null

  // Queue the order for the Tampermonkey script on tingstad.com to pick up
  const handleSendToTingstad = async () => {
    const products = tingstadItems
      .filter(i => !isExcluded(i.id))
      .map(i => ({
        tingstad_id: i.product!.tingstad_id ?? null,
        tingstad_alt_id: i.product!.tingstad_alt_id ?? null,
        name: i.product!.name,
        quantity: i.quantity,
        unit: i.product!.unit ?? '',
      }))
    if (products.length === 0) { toast.error('Inga Tingstad-artiklar i ordern'); return }
    setSendingTingstad(true)
    try {
      const { error } = await supabase.from('tingstad_queue').insert({
        order_id: order.id,
        location_name: order.location?.name ?? '',
        products,
      })
      if (error) throw error
      if (tingstadVendorName) markVendorDone(tingstadVendorName, true, allVendorNames)
      toast.success('✓ I kö — varorna läggs i Tingstad-kundvagnen', { duration: 6000 })
    } catch (err) {
      toast.error(`Kunde inte köa: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingTingstad(false)
    }
  }

  const isPending = order.status === 'pending'
  const isStopped = order.status === 'stopped'

  // Relative, in Swedish time: "13:06" today, "igår 09:34", otherwise "6 sep."
  const TZ = 'Europe/Stockholm'
  const dayKey = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const createdAt = new Date(order.created_at)
  const clock = createdAt.toLocaleTimeString('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  const createdKey = dayKey(createdAt)
  const time = createdKey === dayKey(new Date()) ? clock
    : createdKey === dayKey(new Date(Date.now() - 86_400_000)) ? `igår ${clock}`
    : createdAt.toLocaleDateString('sv-SE', { timeZone: TZ, day: 'numeric', month: 'short' })
  const locationName = order.location?.name ?? 'Unknown location'
  // Vendor label is noise when the vendor *is* the location and the column already names it
  const showVendorLabel = (vendor: string) => showLocation || vendor.trim().toLowerCase() !== locationName.trim().toLowerCase()

  const byVendor = new Map<string, typeof order.items>()
  for (const item of stableItems) {
    const v = effectiveVendor(item)
    byVendor.set(v, [...(byVendor.get(v) ?? []), item])
  }
  const isMultiVendor = byVendor.size > 1

  const vendorEntries = Array.from(byVendor.entries())
  const allVendorNames = vendorEntries.map(([v]) => v)

  const copyButton = (vendor: string) => (
    <button onClick={e => { e.stopPropagation(); copyVendor(vendor) }} title="Kopiera beställningen" aria-label="Kopiera beställningen"
      className="p-1 rounded-lg text-slate-300 dark:text-zinc-600 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors [@media(hover:none)]:p-2.5 [@media(hover:none)]:-my-1.5 [@media(hover:none)]:text-indigo-500 dark:[@media(hover:none)]:text-indigo-400 [@media(hover:none)]:bg-indigo-50 dark:[@media(hover:none)]:bg-indigo-950">
      <Copy size={13} />
    </button>
  )

  const renderItems = (items: typeof order.items) => (
    <div className="space-y-0.5">
      <AnimatePresence initial={false}>
      {items.map(item => {
        const excluded_ = isExcluded(item.id)
        const isOverridden = !!vendorOverrides[item.id]
        return (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center justify-between text-sm group cursor-default select-none py-0.5 overflow-hidden"
            onDoubleClick={() => toggleExclude(item)}
            onTouchStart={() => { if (!isTouch) return; longPress.current = setTimeout(() => { longPress.current = null; toggleExclude(item) }, 550) }}
            onTouchEnd={() => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null } }}
            onTouchMove={() => { if (longPress.current) { clearTimeout(longPress.current); longPress.current = null } }}
            title={isTouch ? 'Håll in för att exkludera från beställningen' : 'Double-click to exclude from notification'}
          >
            <span className={excluded_ ? 'line-through text-red-400' : 'text-slate-700 dark:text-zinc-200'}>
              {item.product?.name ?? 'Deleted product'}
            </span>
            <div className="flex items-center gap-1 [@media(hover:none)]:gap-2 shrink-0">
              <div className="flex items-center justify-end gap-1 [@media(hover:none)]:gap-3 min-w-[4.5rem]">
                {editingQtyItem === item.id ? (
                  <input
                    type="number" inputMode="decimal" min={1} value={qtyDraft}
                    onChange={e => setQtyDraft(e.target.value)}
                    onBlur={() => {
                      const n = parseFloat(qtyDraft)
                      if (!isNaN(n) && n > 0 && n !== item.quantity)
                        updateOrderItem.mutate({ id: item.id, quantity: n })
                      setEditingQtyItem(null)
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingQtyItem(null)
                    }}
                    onClick={e => e.stopPropagation()}
                    onDoubleClick={e => e.stopPropagation()}
                    className="w-10 [@media(hover:none)]:w-14 [@media(hover:none)]:text-base text-sm tabular-nums text-right focus:outline-none bg-transparent font-semibold text-slate-800 dark:text-zinc-100 rounded border border-indigo-300 dark:border-indigo-700 px-1"
                    autoFocus
                  />
                ) : (
                  <span
                    className={`text-sm tabular-nums font-semibold cursor-pointer [@media(hover:none)]:px-2 [@media(hover:none)]:py-1 [@media(hover:none)]:-my-1 [@media(hover:none)]:rounded-md [@media(hover:none)]:bg-slate-100 dark:[@media(hover:none)]:bg-zinc-800 ${excluded_ ? 'line-through text-red-400' : 'text-slate-800 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400'}`}
                    onDoubleClick={e => { e.stopPropagation(); setQtyDraft(String(item.quantity)); setEditingQtyItem(item.id) }}
                    onClick={e => { if (!isTouch) return; e.stopPropagation(); setQtyDraft(String(item.quantity)); setEditingQtyItem(item.id) }}
                    title={isTouch ? 'Tryck för att ändra antal' : 'Double-click to edit'}
                  >{item.quantity}</span>
                )}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); if (editingUnitItem === item.id) { setEditingUnitItem(null) } else { const pos = dropPosFromEvent(e, 88, 180); setUnitDropPos(prev => ({ ...prev, [item.id]: pos })); setEditingUnitItem(item.id) } }}
                    className={`text-xs transition-colors [@media(hover:none)]:px-1.5 [@media(hover:none)]:py-1 [@media(hover:none)]:-my-1 ${unitOverrides[item.id] ? 'text-indigo-500 dark:text-indigo-400 font-medium' : excluded_ ? 'line-through text-red-300 dark:text-red-700' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300'}`}
                  >{effectiveUnit(item)}</button>
                  {editingUnitItem === item.id && createPortal(
                    <>
                      <div className="fixed inset-0 z-[9998]" onClick={() => setEditingUnitItem(null)} />
                      <div className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[88px]" style={unitDropPos[item.id]}>
                        {(unitList ?? []).map(u => (
                          <button key={u.id} onClick={() => {
                            const override = u.name === item.product?.unit ? null : u.name
                            setUnitOverrides(prev => { const next = { ...prev }; if (override === null) delete next[item.id]; else next[item.id] = u.name; return next })
                            updateOrderItem.mutate({ id: item.id, unit_override: override })
                            setEditingUnitItem(null)
                          }} className={`px-2.5 py-1 rounded-lg text-xs text-left transition-colors ${effectiveUnit(item) === u.name ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200'}`}>{u.name}</button>
                        ))}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              </div>
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); if (editingVendorItem === item.id) { setEditingVendorItem(null) } else { const pos = dropPosFromEvent(e, 138, 220); setVendorDropPos(prev => ({ ...prev, [item.id]: pos })); setEditingVendorItem(item.id) } }}
                  title="Change vendor"
                  className={`p-0.5 [@media(hover:none)]:p-1.5 [@media(hover:none)]:-my-1 rounded transition-all ${isOverridden ? 'text-amber-500 opacity-100' : 'text-slate-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 hover:text-slate-500 dark:hover:text-zinc-400'}`}
                ><Tag size={10} /></button>
                {editingVendorItem === item.id && createPortal(
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setEditingVendorItem(null)} />
                    <div className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[138px]" style={vendorDropPos[item.id]}>
                      {(vendorList ?? []).map(v => (
                        <button key={v.id} onClick={() => setItemVendor(item, v.name)} className={`px-2.5 py-1 rounded-lg text-xs text-left transition-colors ${effectiveVendor(item) === v.name ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200'}`}>{v.name}</button>
                      ))}
                    </div>
                  </>,
                  document.body
                )}
              </div>
            </div>
          </motion.div>
        )
      })}
      </AnimatePresence>
    </div>
  )

  // Tingstad controls — visible only when the n8n webhook is configured
  const renderTingstadControls = () => {
    return null // Vilande — Tampermonkey-lösningen används tills vidare
    if (!isPending || doneVendors.has(tingstadVendorName ?? '')) return null
    return (
      <div className="mt-2">
        <button
          onClick={handleSendToTingstad}
          disabled={sendingTingstad}
          className="flex w-full items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium disabled:opacity-50 transition-colors bg-orange-50 dark:bg-orange-950 text-orange-600 dark:text-orange-400 hover:bg-orange-100 dark:hover:bg-orange-900"
        >
          {sendingTingstad ? <Loader2 size={12} className="animate-spin" /> : <><ShoppingBag size={12} /> Skicka till Tingstad</>}
        </button>
      </div>
    )
  }

  // ChefsCulinar controls — rendered inside whichever vendor card owns the CC items
  const renderChefsControls = () => (
    <div className="mt-2 space-y-1.5">
      {isPending && chefsStatus !== 'pending' && !doneVendors.has(chefsVendorName ?? '') && (
        <button
          onClick={handleSendToChefs}
          disabled={sendingChefs}
          className={`flex w-full items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium disabled:opacity-50 transition-colors ${chefsStatus === 'failed' ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900' : 'bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900'}`}
        >
          {sendingChefs
            ? <Loader2 size={12} className="animate-spin" />
            : chefsStatus === 'failed'
              ? <><RotateCcw size={12} /> Försök igen</>
              : <><ShoppingBag size={12} /> Skicka till ChefsCulinar</>}
        </button>
      )}
      {chefsStatus === 'pending' && (
        <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="shrink-0" />
            <span className="font-medium">Skickat — verifiera på ChefsCulinar</span>
          </div>
          <div className="flex items-center gap-1">
            <a href="https://www.chefsculinar.se/sv-se/checkout" target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-900 font-medium transition-colors">
              Öppna
            </a>
            <button
              onClick={() => { setChefsState(null); if (chefsVendorName) markVendorDone(chefsVendorName, true, allVendorNames) }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900 font-medium transition-colors">
              <CheckCircle size={11} /> OK
            </button>
            <button onClick={() => setChefsState('failed')}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900 font-medium transition-colors">
              <X size={11} /> Fel
            </button>
          </div>
        </div>
      )}
      {chefsStatus === 'failed' && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl px-3 py-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={13} className="shrink-0" />
          <span className="font-medium flex-1">Ordern är inte lagd!</span>
        </div>
      )}
    </div>
  )

  // Minimal Email/SMS actions — text only, no icons
  const renderNotifyActions = (vendorName: string) => {
    const v = orderVendors.find(ov => ov.name === vendorName)
    if (!v) return null
    return (
      <>
        {v.email && (
          <button disabled={sending === v.name} onClick={async () => {
            setSending(v.name)
            try {
              await sendEmail(v.email!, `Order – ${order.location?.name ?? ''}`, buildBody(v.name), `Order ${v.name} – ${order.location?.name ?? ''}`)
              toast.success(`Email skickat till ${v.name}`)
              markVendorDone(v.name, true, allVendorNames)
              setShowNotifyVendor(null)
            } catch (err) {
              toast.error(`${v.name}: ${err instanceof Error ? err.message : 'Misslyckades'}`)
            } finally { setSending(null) }
          }} className="flex-1 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors text-center">
            {sending === v.name ? <Loader2 size={11} className="animate-spin inline" /> : 'Email'}
          </button>
        )}
        {v.phone && (
          <SmsLink
            phone={v.phone}
            body={buildBody(v.name)}
            showIcon={false}
            onSent={() => { markVendorDone(v.name, true, allVendorNames); setShowNotifyVendor(null) }}
            className="flex-1 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors text-center"
          />
        )}
        {!v.email && !v.phone && <span className="text-[10px] text-slate-300 dark:text-zinc-600 italic px-2 py-1">Ingen kontaktinfo</span>}
      </>
    )
  }

  // "Ingen beställning" — inga items, bara ett besked från butiken. Egen kompakt
  // kortvy; resten av komponenten förutsätter minst en leverantör.
  if (order.no_order_vendor) {
    const vendor = order.no_order_vendor
    const markSeen = async () => {
      try {
        await updateStatus.mutateAsync({ id: order.id, status: 'done' })
      } catch {
        toast.error('Failed to update order')
      }
    }
    return (
      <motion.div ref={ref} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="relative">
        <div className={`transition-opacity duration-200 ${!isPending ? 'opacity-60 dark:opacity-75 hover:opacity-100' : ''}`}>
          <div className={`rounded-2xl border shadow-sm ${isPending ? 'bg-slate-100 dark:bg-zinc-800 border-dashed border-slate-300 dark:border-zinc-700' : 'bg-[#e2f6ec] dark:bg-emerald-950/40 dark:shadow-[inset_3px_0_0_0_#059669] border-transparent dark:border-zinc-800'}`}>
            <div className="px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 text-slate-500 dark:text-zinc-400">
              <span className="font-normal tabular-nums opacity-60">{time}</span>
              <button onClick={handleDelete} disabled={deleteOrder.isPending} title="Ta bort"
                className="ml-auto p-1 rounded-lg text-red-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-900 disabled:opacity-50 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="px-3 pb-3 flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isPending ? 'bg-slate-200 dark:bg-zinc-800' : 'bg-emerald-100 dark:bg-emerald-900'}`}>
                {isPending ? <Ban size={16} className="text-slate-500 dark:text-zinc-400" /> : <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-zinc-200 truncate">Ingen beställning · {vendor}</p>
                <p className="text-xs text-slate-400 dark:text-zinc-500 truncate">{order.employee?.name ?? 'Unknown'} · {order.location?.name ?? 'Unknown location'}</p>
              </div>
            </div>
            <div className="border-t border-black/5 dark:border-zinc-800">
              {isPending ? (
                <button
                  onClick={markSeen}
                  disabled={updateStatus.isPending}
                  className="w-full flex items-center justify-center py-2 rounded-b-2xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  OK
                </button>
              ) : (
                <button
                  onClick={handleReopen}
                  disabled={updateStatus.isPending}
                  className="w-full flex items-center justify-center py-2 rounded-b-2xl text-xs font-medium text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                >
                  Ångra
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    )
  }

  const isMerged = !!(order as Order & { is_merged?: boolean }).is_merged && isPending
  const firstVendor = vendorEntries[0][0]
  const firstSelected = selectedVendors?.has(firstVendor) ?? false

  const isStale = isPending && Date.now() - new Date(order.created_at).getTime() > 24 * 60 * 60 * 1000

  // Card-level ring only for single-vendor selection; multi-vendor highlights the section instead
  const cardBorder = chefsOrderFailed
    ? 'border-red-400 ring-2 ring-red-100 dark:ring-red-900'
    : !isMultiVendor && firstSelected ? 'border-indigo-400 ring-2 ring-indigo-100 dark:ring-indigo-900'
    : isMerged ? 'border-orange-400 dark:border-orange-800 ring-2 ring-orange-100 dark:ring-orange-900'
    : isStale ? 'border-red-300 dark:border-red-800'
    : 'border-transparent dark:border-zinc-800'
  const statusBarClass = isPending ? 'text-amber-700 dark:text-amber-300' : isStopped ? 'text-slate-500 dark:text-zinc-400' : 'text-emerald-700 dark:text-emerald-300'
  const cardBg = isPending ? 'bg-[#fffaeb] dark:bg-zinc-900 dark:shadow-[inset_3px_0_0_0_#f59e0b]' : isStopped ? 'bg-slate-100 dark:bg-zinc-900 dark:shadow-[inset_3px_0_0_0_#52525b]' : 'bg-[#e2f6ec] dark:bg-emerald-950/40 dark:shadow-[inset_3px_0_0_0_#059669]'

  // Toggle selection when clicking the card itself — ignore clicks on interactive elements
  const cardClick = (vendor: string) => (e: React.MouseEvent) => {
    if (!onToggle) return
    const el = e.target as HTMLElement
    if (el.closest('button, a, input, textarea, select')) return
    onToggle(vendor)
  }

  const selectIcon = (selected: boolean) =>
    selected ? <CheckSquare size={13} className="text-indigo-600 dark:text-indigo-400" /> : <Square size={13} className="text-slate-400 dark:text-zinc-500" />

  const vendorLabel = (vendor: string) => (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500 truncate">{vendor}</p>
  )

  // One section per vendor inside a single card. Multi-vendor sections carry their own
  // select box, notify bell and "Mark done"; single-vendor cards keep those at card level.
  const renderVendorSection = ([vendor, items]: [string, typeof order.items], i: number) => {
    const isVendorDone = doneVendors.has(vendor)
    const isVendorSelected = selectedVendors?.has(vendor) ?? false
    const canNotify = !!orderVendors.find(v => v.name === vendor && (v.email || v.phone))
    const labelShown = showVendorLabel(vendor)
    return (
      <motion.div
        key={vendor}
        layout
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.25 }}
        onClick={isMultiVendor ? cardClick(vendor) : undefined}
        className={`transition-colors duration-300 ${i > 0 ? 'border-t-2 border-dashed border-black/10 dark:border-zinc-700 pt-2.5 mt-2.5' : ''} ${
          isMultiVendor && isVendorSelected ? '-mx-1.5 px-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950 ring-2 ring-indigo-200 dark:ring-indigo-900'
          // Done section inside a pending order: same green as a finished card, bleeding to the card edges
          : isMultiVendor && isPending && isVendorDone ? `-mx-3 px-3 pb-2 bg-[#e2f6ec] dark:bg-emerald-950/50 ${i === 0 ? '-mt-1 pt-1' : ''} ${i === vendorEntries.length - 1 ? '-mb-3 pb-3' : ''}`
          : ''}`}
      >
        {isMultiVendor ? (
          <div className="flex items-center justify-between gap-2 mb-1 -mr-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {onToggle && (
                <button onClick={e => { e.stopPropagation(); onToggle(vendor) }} className="shrink-0 [@media(hover:none)]:p-1.5 [@media(hover:none)]:-m-1.5">{selectIcon(isVendorSelected)}</button>
              )}
              {vendorLabel(vendor)}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {copyButton(vendor)}
              {canNotify && (
                <button onClick={() => toggleNotify(vendor)} title="Notify vendor"
                  className={`p-1.5 rounded-lg transition-colors ${showNotifyVendor === vendor ? 'bg-indigo-600 text-white' : 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-900'}`}>
                  <Bell size={13} />
                </button>
              )}
              <button
                onClick={() => markVendorDone(vendor, !isVendorDone, allVendorNames)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors ${isVendorDone ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 hover:bg-emerald-50 dark:hover:bg-emerald-950 hover:text-emerald-600 dark:hover:text-emerald-400'}`}
              >
                <CheckCircle size={10} /> {isVendorDone ? 'Done' : 'Mark done'}
              </button>
              {isPending && (
                <button
                  onClick={() => removeVendor(vendor, items)}
                  disabled={deleteItems.isPending}
                  title={`Ta bort ${vendor} från ordern`}
                  aria-label={`Ta bort ${vendor} från ordern`}
                  className="p-1 [@media(hover:none)]:p-2 [@media(hover:none)]:-my-1 rounded-lg text-slate-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ) : labelShown ? (
          <div className="flex items-center justify-between mb-0.5 -mr-1">
            {vendorLabel(vendor)}
            {copyButton(vendor)}
          </div>
        ) : null}
        {isMultiVendor && (
          <AnimatePresence>
            {showNotifyVendor === vendor && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex gap-1.5 pb-2">{renderNotifyActions(vendor)}</div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        <div className={`transition-opacity duration-300 ${isVendorDone ? 'opacity-60' : ''}`}>
          {renderItems(items)}
        </div>
        {vendor === chefsVendorName && renderChefsControls()}
        {vendor === tingstadVendorName && renderTingstadControls()}
      </motion.div>
    )
  }

  return (
    <motion.div ref={ref} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="relative">
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`transition-opacity duration-200 ${!isPending ? 'opacity-60 dark:opacity-75 hover:opacity-100' : ''}`}
    >

      <div onClick={isMultiVendor ? undefined : cardClick(firstVendor)} className={`relative z-10 rounded-2xl border shadow-sm transition-[background-color,border-color,box-shadow] duration-300 ${onToggle ? 'cursor-pointer' : ''} ${cardBg} ${cardBorder}`}>
        <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 rounded-t-2xl min-w-0">
          {onToggle && !isMultiVendor && (
            <button onClick={e => { e.stopPropagation(); onToggle(firstVendor) }} className="shrink-0 mr-0.5 [@media(hover:none)]:p-1.5 [@media(hover:none)]:-m-1.5 [@media(hover:none)]:mr-0">{selectIcon(firstSelected)}</button>
          )}
          {!isPending && !isStopped && <CheckCircle size={12} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-label="Klar" />}
          <span className={`text-xs tabular-nums shrink-0 ${isStale ? 'text-red-600 dark:text-red-400 font-semibold' : `${statusBarClass} opacity-70`}`}>{time}</span>
          {isStale && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" title="Väntat över 24h" />}
          <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">{order.employee?.name ?? 'Unknown'}</span>
          {showLocation && <span className="text-xs text-slate-400 dark:text-zinc-500 truncate">· {locationName}</span>}
          {isStopped && <Ban size={12} className="text-slate-400 dark:text-zinc-500 shrink-0" aria-label="Stoppad — ingen beställning" />}
          <span className="ml-auto" />
          {/* Single vendor without a label row: copy lives up here instead of on an otherwise empty row */}
          {!isMultiVendor && !showVendorLabel(firstVendor) && copyButton(firstVendor)}
          {isPending && (
            <button onClick={handleStop} disabled={updateStatus.isPending} title="Stoppa — ingen beställning"
              className="p-1 [@media(hover:none)]:p-2 [@media(hover:none)]:-my-1 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-200/60 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors">
              <Ban size={13} />
            </button>
          )}
          <button onClick={handleDelete} disabled={deleteOrder.isPending} title="Ta bort order"
            className="p-1 [@media(hover:none)]:p-2 [@media(hover:none)]:-my-1 rounded-lg text-red-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-100/60 dark:hover:bg-red-900 disabled:opacity-50 transition-colors">
            <Trash2 size={13} />
          </button>
        </div>

        <div className="px-3 pb-3 pt-1 space-y-2">
          {order.note && (
            <div className="flex items-start gap-2 bg-slate-50 dark:bg-zinc-800 rounded-xl p-2.5 text-xs text-slate-600 dark:text-zinc-300">
              <FileText size={12} className="text-slate-400 dark:text-zinc-500 mt-0.5 shrink-0" />
              {order.note}
            </div>
          )}
          <div><AnimatePresence initial={false}>{vendorEntries.map(renderVendorSection)}</AnimatePresence></div>
        </div>

        {/* Integrated action bar. Finished cards: Order always visible, Note/Ångra slide in on hover or via ⋯ */}
        <div className="border-t border-black/5 dark:border-zinc-800">
          <div className="flex divide-x divide-black/5 dark:divide-zinc-800 text-xs font-medium">
            <button
              onClick={() => toggleNotify(firstVendor)}
              disabled={orderVendors.length === 0}
              className={`flex-1 flex items-center justify-center py-2 transition-colors disabled:opacity-30 ${!isPending ? 'rounded-bl-2xl' : ''} ${showNotifyVendor === firstVendor ? 'bg-indigo-600 text-white' : 'text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950'}`}
            >
              Order
            </button>
            {isPending ? (
              <button
                onClick={() => { setEditingNote(v => !v); setNoteVal(order.admin_note ?? '') }}
                className={`flex-1 flex items-center justify-center py-2 transition-colors ${order.admin_note || editingNote ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950' : 'text-slate-500 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 dark:hover:text-red-400'}`}
              >
                Note
              </button>
            ) : (
              <>
                <AnimatePresence initial={false}>
                  {(hovered || actionsPinned || editingNote) && (
                    <motion.div
                      key="more-actions"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="flex overflow-hidden divide-x divide-black/5 dark:divide-zinc-800 shrink-0"
                    >
                      <button
                        onClick={() => { setEditingNote(v => !v); setNoteVal(order.admin_note ?? '') }}
                        className={`px-4 py-2 whitespace-nowrap transition-colors ${order.admin_note || editingNote ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950' : 'text-slate-500 dark:text-zinc-400 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-500 dark:hover:text-red-400'}`}
                      >
                        Note
                      </button>
                      <button
                        onClick={handleReopen}
                        disabled={updateStatus.isPending}
                        className="px-4 py-2 whitespace-nowrap text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 disabled:opacity-30 transition-colors"
                      >
                        Ångra
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button
                  onClick={() => setActionsPinned(v => !v)}
                  title="Fler åtgärder"
                  aria-expanded={hovered || actionsPinned}
                  className={`px-2.5 [@media(hover:none)]:px-4 py-2 rounded-br-2xl transition-colors ${actionsPinned ? 'text-slate-700 dark:text-zinc-200 bg-slate-100 dark:bg-zinc-800' : 'text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}
                >
                  <MoreHorizontal size={14} />
                </button>
              </>
            )}
          </div>
          <AnimatePresence>
            {!isMultiVendor && showNotifyVendor === firstVendor && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex gap-1.5 px-2 py-1.5">{renderNotifyActions(firstVendor)}</div>
              </motion.div>
            )}
          </AnimatePresence>
          {isPending && (
            <button
              onClick={() => { markAllVendorsDone(allVendorNames); handleComplete(); triggerCelebrate() }}
              disabled={updateStatus.isPending}
              className="w-full flex items-center justify-center py-2 rounded-b-2xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors border-t border-black/5 dark:border-transparent"
            >
              Done
            </button>
          )}
        </div>

        {/* Confetti burst on Done */}
        <AnimatePresence>
          {celebrate && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
              {Array.from({ length: 14 }).map((_, i) => {
                const angle = (i / 14) * Math.PI * 2
                const dist = 70 + (i % 3) * 25
                const colors = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#3b82f6']
                return (
                  <motion.span
                    key={i}
                    initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                    animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: 0, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.7, ease: 'easeOut' }}
                    className="absolute w-2 h-2 rounded-full"
                    style={{ backgroundColor: colors[i % colors.length] }}
                  />
                )
              })}
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>

    {/* Admin note — edit or display */}
    <AnimatePresence>
      {(editingNote || order.admin_note) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden mt-1.5 relative z-10"
        >
          {editingNote ? (
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-2.5 flex gap-2">
              <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
              <textarea
                autoFocus
                value={noteVal}
                onChange={e => setNoteVal(e.target.value)}
                onBlur={saveNote}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveNote() } if (e.key === 'Escape') { setEditingNote(false); setNoteVal(order.admin_note ?? '') } }}
                placeholder="Anteckning… (Enter för att spara, Esc för att avbryta)"
                rows={2}
                className="flex-1 text-xs text-red-800 dark:text-red-300 bg-transparent resize-none focus:outline-none placeholder:text-red-300 dark:placeholder:text-red-700"
              />
            </div>
          ) : order.admin_note ? (
            <button onClick={() => { setEditingNote(true); setNoteVal(order.admin_note ?? '') }}
              className="w-full text-left bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-xl p-2.5 flex items-start gap-2 hover:bg-red-100 dark:hover:bg-red-900 transition-colors">
              <AlertCircle size={13} className="text-red-400 mt-0.5 shrink-0" />
              <span className="text-xs text-red-800 dark:text-red-300">{order.admin_note}</span>
            </button>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
    </motion.div>
  )
})

export default OrderCard
