import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Minus, Package, X, Trash2 } from 'lucide-react'
import { useCartStore } from '../../store/cartStore'
import type { Product } from '../../types'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  const { items, addItem, updateQuantity, removeItem } = useCartStore()
  const cartItem = items.find(i => i.product_id === product.id)
  const quantity = cartItem?.quantity ?? 0
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [scrubber, setScrubber] = useState<{ x: number; y: number; qty: number } | null>(null)
  const dragState = useRef<{ startY: number; startQty: number; last: number } | null>(null)

  const onQtyPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    dragState.current = { startY: e.clientY, startQty: quantity, last: quantity }
    const cx = Math.max(36, Math.min(rect.left + rect.width / 2, window.innerWidth - 36))
    setScrubber({ x: cx, y: rect.top + rect.height / 2, qty: quantity })
  }
  const onQtyPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragState.current) return
    const delta = dragState.current.startY - e.clientY
    const next = Math.max(0, dragState.current.startQty + Math.round(delta / 18))
    if (next !== dragState.current.last) {
      dragState.current.last = next
      // Keep qty ≥ 1 in cart during drag so the span stays mounted; handle 0 on release
      if (next > 0) updateQuantity(product.id, next)
    }
    setScrubber(s => s ? { ...s, qty: next } : null)
  }
  const onQtyPointerUp = () => {
    const last = dragState.current?.last ?? quantity
    dragState.current = null
    if (last === 0) {
      setTimeout(() => { removeItem(product.id); setScrubber(null) }, 500)
    } else {
      setTimeout(() => setScrubber(null), 500)
    }
  }

  const scrubberOffsets = [2, 1, 0, -1, -2]

  return (
    <>
      <AnimatePresence>
        {scrubber && (
          <motion.div
            className="fixed z-[200] pointer-events-none"
            style={{ left: scrubber.x, top: scrubber.y, transform: 'translate(-50%, -50%)' }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300, duration: 0.2 }}
          >
            <div className="relative w-14">
              <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
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
              <div className="absolute inset-x-0 top-0 h-9 bg-gradient-to-b from-white to-transparent rounded-t-2xl pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-white to-transparent rounded-b-2xl pointer-events-none" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group"
        onClick={() => addItem(product)}
      >
        {/* Thumbnail — trash overlaid when item is in cart */}
        <div className="relative w-12 h-12 shrink-0">
          <div
            className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden cursor-zoom-in"
            onClick={e => {
              e.stopPropagation()
              if (product.image_url) setLightboxOpen(true)
            }}
          >
            {product.image_url ? (
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package size={18} className="text-slate-300" />
              </div>
            )}
          </div>
          <AnimatePresence>
            {quantity > 0 && (
              <motion.button
                key="trash"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.15 }}
                onClick={e => { e.stopPropagation(); removeItem(product.id) }}
                className="absolute inset-0 w-full h-full rounded-xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={16} className="text-white" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-900 text-sm leading-tight">{product.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{product.unit}</p>
        </div>

        {/* Quantity controls */}
        <div className="shrink-0" onClick={e => e.stopPropagation()}>
          <AnimatePresence mode="wait">
            {quantity === 0 ? (
              <motion.button
                key="add"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => addItem(product)}
                className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center hover:bg-indigo-100 transition-colors"
              >
                <Plus size={16} className="text-indigo-600" />
              </motion.button>
            ) : (
              <motion.div
                key="controls"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2"
              >
                <button
                  onClick={() => updateQuantity(product.id, quantity - 1)}
                  className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
                >
                  <Minus size={14} className="text-slate-600" />
                </button>
                <span
                  className="text-sm font-bold text-slate-900 w-5 text-center tabular-nums cursor-ns-resize select-none touch-none"
                  onPointerDown={onQtyPointerDown}
                  onPointerMove={onQtyPointerMove}
                  onPointerUp={onQtyPointerUp}
                  onPointerCancel={onQtyPointerUp}
                  title="Drag up/down to change quantity"
                >{quantity}</span>
                <button
                  onClick={() => addItem(product)}
                  className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center hover:bg-indigo-700 transition-colors"
                >
                  <Plus size={14} className="text-white" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Image lightbox */}
      <AnimatePresence>
        {lightboxOpen && product.image_url && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
            onClick={() => setLightboxOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="relative max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full rounded-2xl shadow-2xl"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent rounded-b-2xl px-4 py-3">
                <p className="text-white font-semibold text-sm">{product.name}</p>
                <p className="text-white/60 text-xs">{product.vendor} · {product.unit}</p>
              </div>
              <button
                onClick={() => setLightboxOpen(false)}
                className="absolute top-2 right-2 w-8 h-8 bg-black/40 rounded-full flex items-center justify-center"
              >
                <X size={16} className="text-white" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
