import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, RotateCcw, Trash2, Clock, MapPin, User, FileText, Mail, Phone, X, Bell, CheckSquare, Square, Loader2, Tag, ShoppingBag } from 'lucide-react'
import type { OrderWithDetails } from '../../types'
import { useUpdateOrderStatus, useDeleteOrder, useUpdateOrderItem } from '../../hooks/useOrders'
import { useVendors, useUnits } from '../../hooks/useMetadata'
import { sendEmail } from '../../lib/sendEmail'
import toast from 'react-hot-toast'

interface Props {
  order: OrderWithDetails
  selected?: boolean
  onToggle?: () => void
}

export default function OrderCard({ order, selected, onToggle }: Props) {
  const updateStatus = useUpdateOrderStatus()
  const deleteOrder = useDeleteOrder()
  const { data: vendorList } = useVendors()
  const updateOrderItem = useUpdateOrderItem()
  const [showNotify, setShowNotify] = useState(false)
  const [doneVendors, setDoneVendors] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState<string | null>(null)
  const [editingVendorItem, setEditingVendorItem] = useState<string | null>(null)
  const [editingQtyItem, setEditingQtyItem] = useState<string | null>(null)
  const [qtyDraft, setQtyDraft] = useState('')
  const [sendingChefs, setSendingChefs] = useState(false)

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
  const [editingUnitItem, setEditingUnitItem] = useState<string | null>(null)
  const [unitDropUp, setUnitDropUp] = useState<Record<string, boolean>>({})
  const [vendorDropUp, setVendorDropUp] = useState<Record<string, boolean>>({})

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

  const buildBody = (vendorName: string) => {
    const items = order.items.filter(i =>
      effectiveVendor(i) === vendorName && !isExcluded(i.id)
    )
    const lines = items.map(i => `${i.product?.vendor_name ?? i.product?.name ?? '?'}: ${i.quantity} ${effectiveUnit(i)}`)
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
    try {
      await updateStatus.mutateAsync({ id: order.id, status: 'done' })
      toast.success('Order marked as done')
      if (orderVendors.length > 0) setShowNotify(true)
    } catch {
      toast.error('Failed to update order')
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

  const handleDelete = async () => {
    if (!confirm('Delete this order?')) return
    try {
      await deleteOrder.mutateAsync(order.id)
      toast.success('Order deleted')
    } catch {
      toast.error('Failed to delete order')
    }
  }

  const chefsItems = order.items.filter(i => i.product?.chefsculinar_id)

  const handleSendToChefs = async () => {
    const webhookUrl = import.meta.env.VITE_N8N_CHEFSCULINAR_WEBHOOK
    if (!webhookUrl) { toast.error('Webhook URL saknas'); return }
    const products = chefsItems.map(i => ({
      chefsculinar_id: i.product!.chefsculinar_id,
      quantity: i.quantity,
      unit: i.product!.chefsculinar_unit ?? 'st',
      unit_qty: i.product!.chefsculinar_unit_qty ?? 1,
    }))
    setSendingChefs(true)
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
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await updateStatus.mutateAsync({ id: order.id, status: 'done' })
      toast.success('Beställning lagd hos ChefsCulinar!')
    } catch (err) {
      toast.error(`Misslyckades: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingChefs(false)
    }
  }

  const isPending = order.status === 'pending'

  const time = new Date(order.created_at).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })

  const byVendor = new Map<string, typeof order.items>()
  for (const item of order.items) {
    const v = effectiveVendor(item)
    byVendor.set(v, [...(byVendor.get(v) ?? []), item])
  }
  const isMultiVendor = byVendor.size > 1

  const vendorEntries = Array.from(byVendor.entries())

  const renderItems = (items: typeof order.items) => (
    <div className="space-y-0.5">
      {items.map(item => {
        const excluded_ = isExcluded(item.id)
        const isOverridden = !!vendorOverrides[item.id]
        return (
          <div
            key={item.id}
            className="flex items-center justify-between text-sm group cursor-default select-none py-0.5"
            onDoubleClick={() => toggleExclude(item)}
            title="Double-click to exclude from notification"
          >
            <span className={excluded_ ? 'line-through text-red-400' : 'text-slate-700'}>
              {item.product?.name ?? 'Deleted product'}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <div className={`flex items-center rounded-lg px-1.5 py-0.5 gap-1 ${excluded_ ? 'bg-red-50' : 'bg-slate-100'}`}>
                {editingQtyItem === item.id ? (
                  <input
                    type="number" min={1} value={qtyDraft}
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
                    className="w-10 text-xs tabular-nums text-right focus:outline-none bg-transparent font-medium text-slate-700"
                    autoFocus
                  />
                ) : (
                  <span
                    className={`text-xs tabular-nums font-medium cursor-pointer ${excluded_ ? 'line-through text-red-400' : 'text-slate-600 hover:text-indigo-600'}`}
                    onDoubleClick={e => { e.stopPropagation(); setQtyDraft(String(item.quantity)); setEditingQtyItem(item.id) }}
                    title="Double-click to edit"
                  >{item.quantity}</span>
                )}
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); if (editingUnitItem !== item.id) { const rect = e.currentTarget.getBoundingClientRect(); setUnitDropUp(prev => ({ ...prev, [item.id]: rect.bottom + 150 > window.innerHeight })) } setEditingUnitItem(prev => prev === item.id ? null : item.id) }}
                    className={`text-xs transition-colors ${unitOverrides[item.id] ? 'text-indigo-500 font-medium' : excluded_ ? 'line-through text-red-300' : 'text-slate-400 hover:text-slate-600'}`}
                  >{effectiveUnit(item)}</button>
                  {editingUnitItem === item.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setEditingUnitItem(null)} />
                      <div className={`absolute right-0 ${unitDropUp[item.id] ? 'bottom-full mb-1' : 'top-full mt-1'} z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[80px]`}>
                        {(unitList ?? []).map(u => (
                          <button key={u.id} onClick={() => {
                            const override = u.name === item.product?.unit ? null : u.name
                            setUnitOverrides(prev => { const next = { ...prev }; if (override === null) delete next[item.id]; else next[item.id] = u.name; return next })
                            updateOrderItem.mutate({ id: item.id, unit_override: override })
                            setEditingUnitItem(null)
                          }} className={`px-2.5 py-1 rounded-lg text-xs text-left transition-colors ${effectiveUnit(item) === u.name ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}>{u.name}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); if (editingVendorItem !== item.id) { const rect = e.currentTarget.getBoundingClientRect(); setVendorDropUp(prev => ({ ...prev, [item.id]: rect.bottom + 180 > window.innerHeight })) } setEditingVendorItem(prev => prev === item.id ? null : item.id) }}
                  title="Change vendor"
                  className={`p-0.5 rounded transition-all ${isOverridden ? 'text-amber-500 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-500'}`}
                ><Tag size={10} /></button>
                {editingVendorItem === item.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setEditingVendorItem(null)} />
                    <div className={`absolute right-0 ${vendorDropUp[item.id] ? 'bottom-full mb-1' : 'top-full mt-1'} z-50 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[130px]`}>
                      {(vendorList ?? []).map(v => (
                        <button key={v.id} onClick={() => setItemVendor(item, v.name)} className={`px-2.5 py-1 rounded-lg text-xs text-left transition-colors ${effectiveVendor(item) === v.name ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 text-slate-700'}`}>{v.name}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  const cardBorder = selected ? 'border-indigo-400 ring-2 ring-indigo-100' : isPending ? 'border-amber-200' : 'border-slate-100'
  const statusBarClass = selected ? 'bg-indigo-50 text-indigo-700' : isPending ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={`relative transition-opacity ${!isPending ? 'opacity-50 hover:opacity-100' : ''}`}>

      {/* Green connecting line — centered, visible in the gaps between vendor cards */}
      {isMultiVendor && (
        <div className="absolute left-1/2 -translate-x-px top-3 bottom-3 w-0.5 bg-emerald-400 rounded-full z-0" />
      )}

      {/* Main card — order header + first vendor */}
      <div className={`relative z-10 bg-white rounded-2xl border shadow-sm transition-shadow ${cardBorder}`}>
        <div className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 rounded-t-2xl ${statusBarClass}`}>
          {onToggle && (
            <button onClick={e => { e.stopPropagation(); onToggle() }} className="shrink-0 mr-0.5">
              {selected ? <CheckSquare size={13} className="text-indigo-600" /> : <Square size={13} className="text-slate-400" />}
            </button>
          )}
          {isPending ? <Clock size={12} /> : <CheckCircle size={12} />}
          {isPending ? 'Pending' : 'Completed'}
          <span className="ml-auto font-normal opacity-60 tabular-nums">{time}</span>
        </div>

        <div className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-1.5 text-sm text-slate-600">
                <User size={13} className="text-slate-400 shrink-0" />
                <span className="font-medium text-slate-900 truncate">{order.employee?.name ?? 'Unknown'}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <MapPin size={11} className="shrink-0" />
                <span className="truncate">{order.location?.name ?? 'Unknown location'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {chefsItems.length > 0 && isPending && (
                <button onClick={handleSendToChefs} disabled={sendingChefs} title="Skicka till ChefsCulinar"
                  className="p-1.5 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                  {sendingChefs ? <Loader2 size={14} className="animate-spin" /> : <ShoppingBag size={14} />}
                </button>
              )}
              {orderVendors.length > 0 && (
                <button onClick={() => setShowNotify(v => !v)} title="Notify vendors"
                  className={`p-1.5 rounded-lg text-xs transition-colors ${showNotify ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                  <Bell size={14} />
                </button>
              )}
              {isPending ? (
                <button onClick={handleComplete} disabled={updateStatus.isPending} title="Mark as done"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  <CheckCircle size={13} /> Done
                </button>
              ) : (
                <button onClick={handleReopen} disabled={updateStatus.isPending} title="Reopen order"
                  className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 disabled:opacity-50 transition-colors">
                  <RotateCcw size={14} />
                </button>
              )}
              <button onClick={handleDelete} disabled={deleteOrder.isPending} title="Delete order"
                className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="border-t border-slate-50 pt-2">
            {isMultiVendor && (
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{vendorEntries[0][0]}</p>
                <button
                  onClick={() => setDoneVendors(prev => { const s = new Set(prev); s.has(vendorEntries[0][0]) ? s.delete(vendorEntries[0][0]) : s.add(vendorEntries[0][0]); return s })}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors ${doneVendors.has(vendorEntries[0][0]) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}
                >
                  <CheckCircle size={10} /> {doneVendors.has(vendorEntries[0][0]) ? 'Done' : 'Mark done'}
                </button>
              </div>
            )}
            {!isMultiVendor && <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">{vendorEntries[0][0]}</p>}
            <div className={doneVendors.has(vendorEntries[0][0]) ? 'opacity-40' : ''}>
              {renderItems(vendorEntries[0][1])}
            </div>
          </div>

          {order.note && (
            <div className="flex items-start gap-2 bg-slate-50 rounded-xl p-2.5 text-xs text-slate-600">
              <FileText size={12} className="text-slate-400 mt-0.5 shrink-0" />
              {order.note}
            </div>
          )}

          <AnimatePresence>
            {showNotify && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="border-t border-slate-100 pt-3 space-y-1.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Notify vendors</span>
                    <button onClick={() => setShowNotify(false)} className="text-slate-300 hover:text-slate-500 transition-colors"><X size={13} /></button>
                  </div>
                  {orderVendors.map(v => (
                    <div key={v.name} className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-600 font-medium flex-1 truncate">{v.name}</span>
                      {v.email && (
                        <button disabled={sending === v.name} onClick={async () => {
                          setSending(v.name)
                          try {
                            await sendEmail(v.email!, `Order – ${order.location?.name ?? ''}`, buildBody(v.name))
                            toast.success(`Email sent to ${v.name}`)
                            setDoneVendors(prev => new Set(prev).add(v.name))
                            if (isPending) await updateStatus.mutateAsync({ id: order.id, status: 'done' })
                          } catch (err) {
                            toast.error(`${v.name}: ${err instanceof Error ? err.message : 'Failed to send'}`)
                          } finally { setSending(null) }
                        }} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors">
                          {sending === v.name ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />} Email
                        </button>
                      )}
                      {v.phone && (
                        <a href={`sms:${v.phone}?body=${encodeURIComponent(buildBody(v.name))}`}
                          onClick={() => { setDoneVendors(prev => new Set(prev).add(v.name)); if (isPending) updateStatus.mutateAsync({ id: order.id, status: 'done' }) }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-colors">
                          <Phone size={11} /> SMS
                        </a>
                      )}
                      {!v.email && !v.phone && <span className="text-[10px] text-slate-300 italic">No contact info</span>}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Additional vendor cards — one per extra vendor, connected by the green line */}
      {isMultiVendor && vendorEntries.slice(1).map(([vendor, items]) => {
        const isVendorDone = doneVendors.has(vendor)
        return (
          <div key={vendor} className="relative z-10 mt-2 bg-white rounded-2xl border border-slate-100 shadow-sm">
            <div className="px-3 py-2 border-b border-slate-50 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{vendor}</p>
              <button
                onClick={() => setDoneVendors(prev => { const s = new Set(prev); s.has(vendor) ? s.delete(vendor) : s.add(vendor); return s })}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-colors ${isVendorDone ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}
              >
                <CheckCircle size={10} /> {isVendorDone ? 'Done' : 'Mark done'}
              </button>
            </div>
            <div className={`p-3 ${isVendorDone ? 'opacity-40' : ''}`}>
              {renderItems(items)}
            </div>
          </div>
        )
      })}
    </motion.div>
  )
}
