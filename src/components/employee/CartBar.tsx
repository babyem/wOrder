import { motion, AnimatePresence } from 'framer-motion'
import { ShoppingCart, ChevronUp } from 'lucide-react'
import { useCartStore } from '../../store/cartStore'

interface Props {
  onOpen: () => void
}

export default function CartBar({ onOpen }: Props) {
  const items = useCartStore(s => s.items)
  const total = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <AnimatePresence>
      {total > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-0 left-0 right-0 z-40 px-4 pb-6 pt-2"
        >
          <button
            onClick={onOpen}
            className="w-full max-w-2xl mx-auto flex items-center justify-between bg-indigo-600 text-white px-6 py-4 rounded-2xl shadow-2xl shadow-indigo-500/30 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <ShoppingCart size={22} />
                <span className="absolute -top-2 -right-2 w-5 h-5 bg-white text-indigo-600 rounded-full text-xs font-bold flex items-center justify-center">
                  {total}
                </span>
              </div>
              <div className="text-left">
                <p className="font-semibold">View Order</p>
                <p className="text-indigo-200 text-xs">{items.length} product{items.length !== 1 ? 's' : ''}</p>
              </div>
            </div>
            <ChevronUp size={20} className="text-indigo-300" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
