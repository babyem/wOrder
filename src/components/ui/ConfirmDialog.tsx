import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useConfirmStore } from '../../store/confirmStore'

export default function ConfirmDialog() {
  const open = useConfirmStore(s => s.open)
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Avbryt', danger } = useConfirmStore(s => s.options)
  const answer = useConfirmStore(s => s.answer)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false)
      if (e.key === 'Enter') answer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, answer])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => answer(false)}
          />
          <motion.div
            role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
            className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-zinc-800 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5"
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ opacity: { duration: 0.15 }, default: { type: 'spring', damping: 26, stiffness: 320 } }}
          >
            <div className="flex items-start gap-3">
              {danger && (
                <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950 text-red-500 dark:text-red-400 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} />
                </div>
              )}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-base font-semibold text-slate-900 dark:text-zinc-100">{title}</h2>
                {message && <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">{message}</p>}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => answer(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                autoFocus
                onClick={() => answer(true)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-700'}`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
