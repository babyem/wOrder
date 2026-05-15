import { useState } from 'react'
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
    } catch {
      toast.error('Failed to submit order. Please try again.')
    }
  }

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

  return (
    <Modal open={open} onClose={onClose} title="Your Order">
      <div className="space-y-4">
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {items.map(item => (
            <div key={item.product_id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 text-sm truncate">{item.product.name}</p>
                <p className="text-xs text-slate-400">{item.product.unit}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => updateQuantity(item.product_id, item.quantity - 1)}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center hover:bg-slate-100 transition-colors"
                >
                  {item.quantity === 1 ? <Trash2 size={13} className="text-red-400" /> : <Minus size={13} className="text-slate-600" />}
                </button>
                <span className="text-sm font-semibold w-5 text-center text-slate-900">{item.quantity}</span>
                <button
                  onClick={() => updateQuantity(item.product_id, item.quantity + 1)}
                  className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={13} className="text-white" />
                </button>
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
  )
}
