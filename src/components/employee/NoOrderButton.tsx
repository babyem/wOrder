import { useState } from 'react'
import { Ban, CheckCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import { useProducts } from '../../hooks/useProducts'
import { useSubmitNoOrder } from '../../hooks/useOrders'

// Bara Kho har den här knappen — de får en samlad order per dag och vill veta
// när en butik inte beställer alls.
const VENDOR = 'Kho'

const todayKey = () => new Date().toLocaleDateString('sv-SE')
const storageKey = (locationId: string) => `no_order_${VENDOR}_${locationId}`

const readSentToday = (locationId: string) => {
  try { return localStorage.getItem(storageKey(locationId)) === todayKey() } catch { return false }
}

interface Props {
  locationId: string
  employeeId: string
  locationName: string
}

export default function NoOrderButton({ locationId, employeeId, locationName }: Props) {
  const { data: products } = useProducts(true, locationId)
  const submit = useSubmitNoOrder()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sentToday, setSentToday] = useState(() => readSentToday(locationId))

  // Visa bara knappen för butiker som faktiskt beställer från Kho
  const hasVendor = products?.some(p => p.vendor === VENDOR) ?? false
  if (!hasVendor) return null

  const handleConfirm = async () => {
    try {
      await submit.mutateAsync({ locationId, employeeId, vendor: VENDOR })
      try { localStorage.setItem(storageKey(locationId), todayKey()) } catch { /* ignore */ }
      setSentToday(true)
      setConfirmOpen(false)
      toast.success(`Backoffice vet nu att ni inte beställer från ${VENDOR} idag`)
    } catch (err) {
      toast.error(`Kunde inte skicka: ${err instanceof Error ? err.message : 'okänt fel'}`)
    }
  }

  return (
    <>
      <div className={`rounded-2xl border shadow-sm px-4 py-3 flex items-center gap-3 ${sentToday ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-100 dark:border-emerald-900' : 'bg-white dark:bg-zinc-900 border-slate-100 dark:border-zinc-800'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${sentToday ? 'bg-emerald-100 dark:bg-emerald-900' : 'bg-slate-100 dark:bg-zinc-800'}`}>
          {sentToday ? <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" /> : <Ban size={18} className="text-slate-500 dark:text-zinc-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100">{VENDOR}</p>
          <p className="text-xs text-slate-400 dark:text-zinc-500">
            {sentToday
              ? 'Meddelat: ingen beställning idag. Vill ni ändå beställa? Lägg en order som vanligt.'
              : `Beställer ni inget från ${VENDOR} idag? Säg till backoffice.`}
          </p>
        </div>
        {!sentToday && (
          <button
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-xs font-semibold text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 active:scale-95 transition-all"
          >
            Ingen beställning
          </button>
        )}
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Ingen beställning från ${VENDOR}`} maxWidth="max-w-sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-zinc-300">
            Meddela backoffice att <span className="font-semibold text-slate-900 dark:text-zinc-100">{locationName || 'butiken'}</span> inte beställer från {VENDOR} idag?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={submit.isPending}
              className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm font-medium text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              Avbryt
            </button>
            <button
              onClick={handleConfirm}
              disabled={submit.isPending}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 dark:bg-zinc-800 text-white text-sm font-semibold hover:bg-slate-800 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {submit.isPending ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
              Ja, ingen beställning
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
