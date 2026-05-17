import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Minus, Plus, Trash2, Send, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useCartStore } from '../../store/cartStore'
import { useSubmitOrder } from '../../hooks/useOrders'

interface Props {
  open: boolean
  onClose: () => void
  locationId: string
  employeeId: string
}

export default function OrderModal({ open, onClose, locationId, employeeId }: Props) {
  const [note, setNote] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const { items, updateQuantity, clearCart } = useCartStore()
  const submit = useSubmitOrder()
  const [scrubber, setScrubber] = useState<{ x: number; y: number; qty: number } | null>(null)
  const dragState = useRef<{ startY: number; startQty: number; last: number; productId: string } | null>(null)

  const onQtyPointerDown = (e: React.PointerEvent<HTMLSpanElement>, productId: string, qty: number) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    dragState.current = { startY: e.clientY, startQty: qty, last: qty, productId }
    setScrubber({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, qty })
  }
  const onQtyPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragState.current) return
    const delta = dragState.current.startY - e.clientY
    const next = Math.max(0, dragState.current.startQty + Math.round(delta / 18))
    if (next !== dragState.current.last) {
      dragState.current.last = next
      if (next === 0) updateQuantity(dragState.current.productId, 0)
      else updateQuantity(dragState.current.productId, next)
    }
    setScrubber(s => s ? { ...s, qty: next } : null)
  }
  const onQtyPointerUp = () => { dragState.current = null; setScrubber(null) }

  const handleSubmit = async () => {
    if (!items.length) return
    try {
      await submit.mutateAsync({ locationId, employeeId, note, items })
      setSubmitted(true)
      setTimeout(() => {
        clearCart()
        setSubmitted(false)
        setNote('')
        onClose()
        toast.success('Order submitted successfully!')
      }, 1800)
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : (err as Record<string, unknown>)?.message as string ?? JSON.stringify(err)
      toast.error(`Failed to submit order: ${msg}`)
    }
  }

  const scrubberOffsets = [2, 1, 0, -1, -2]
  const scrubberOverlay = scrubber && (
    <div
      className="fixed z-[300] pointer-events-none"
      style={{ left: scrubber.x, top: scrubber.y, transform: 'translate(-50%, -50%)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden w-14">
        {scrubberOffsets.map(offset => {
          const n = scrubber.qty + offset
          const isCenter = offset === 0
          return (
            <div
              key={offset}
              className={`text-center py-1 leading-tight ${
                isCenter
                  ? 'text-indigo-600 font-bold text-xl bg-indigo-50'
                  : Math.abs(offset) === 1
                    ? 'text-slate-400 text-sm'
                    : 'text-slate-200 text-xs'
              }`}
            >
              {n >= 0 ? n : ''}
            </div>
          )
        })}
      </div>
    </div>
  )

  if (submitted) {
    return (
      <Modal open={open} onClose={() => {}} title="Order Submitted">
        <div className="flex flex-col items-center py-8 gap-3">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', damping: 15, stiffness: 300 }}
          >
            <CheckCircle size={56} className="text-emerald-500" />
          </motion.div>
          <p className="text-lg font-semibold text-slate-900">Order sent!</p>
          <p className="text-slate-400 text-sm">Your order has been received.</p>
        </div>
      </Modal>
    )
  }

  const byVendor = items.reduce<Record<string, typeof items>>((acc, item) => {
    const v = item.product.vendor ?? 'Övrigt'
    acc[v] = [...(acc[v] ?? []), item]
    return acc
  }, {})

  return (
    <>
    {scrubberOverlay}
    <Modal open={open} onClose={onClose} title="Your Order">
      <div className="space-y-4">
        <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
          {Object.entries(byVendor).map(([vendor, vendorItems]) => (
            <div key={vendor}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 px-0.5">{vendor}</p>
              <div className="space-y-0.5">
                {vendorItems.map(item => (
                  <div key={item.product_id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-900 truncate block">{item.product.name}</span>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">{item.product.unit}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                        className="w-6 h-6 rounded-md bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                      >
                        {item.quantity === 1 ? <Trash2 size={11} className="text-red-400" /> : <Minus size={11} className="text-slate-600" />}
                      </button>
                      <span
                        className="text-sm font-semibold w-5 text-center text-slate-900 cursor-ns-resize select-none touch-none"
                        onPointerDown={e => onQtyPointerDown(e, item.product_id, item.quantity)}
                        onPointerMove={onQtyPointerMove}
                        onPointerUp={onQtyPointerUp}
                        onPointerCancel={onQtyPointerUp}
                        title="Drag up/down to change quantity"
                      >{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                        className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center hover:bg-indigo-700 transition-colors"
                      >
                        <Plus size={11} className="text-white" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Note (optional)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Any special instructions..."
            rows={2}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={submit.isPending || !items.length}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3.5 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submit.isPending ? <Spinner size={18} className="border-white border-t-white/30" /> : <Send size={18} />}
          {submit.isPending ? 'Sending...' : 'Submit Order'}
        </button>
      </div>
    </Modal>
    </>
  )
}
