import { motion } from 'framer-motion'
import { AlertTriangle, Clock, CalendarCheck, Ban, EyeOff, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useDismissGap, VENDOR_GAPS_KEY, type VendorGap } from '../../hooks/useVendorGaps'
import { useSubmitNoOrder } from '../../hooks/useOrders'
import { confirmDialog } from '../../store/confirmStore'

const WEEKDAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'long' })

function stockholmNow(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
}

/** Rött när butikens vanliga beställningstid passerat, annars orange. */
export function gapIsLate(gap: VendorGap): boolean {
  return !!gap.usual_time && stockholmNow() > gap.usual_time
}

interface Props {
  gap: VendorGap
  locationName: string
}

// Spökkort överst i kolumnen: "den här ordern borde ha kommit". Bara ikoner —
// förklaringen ligger i tooltips. Försvinner av sig självt när ordern kommer in.
export default function VendorGapCard({ gap, locationName }: Props) {
  const qc = useQueryClient()
  const dismiss = useDismissGap()
  const noOrder = useSubmitNoOrder()
  const late = gapIsLate(gap)
  const weekday = WEEKDAY.format(new Date())

  const explain = `${locationName} brukar beställa från ${gap.vendor} på ${weekday}ar` +
    ` (${gap.days_hit} av senaste ${gap.days_total})` +
    (gap.usual_time ? `, oftast runt ${gap.usual_time}` : '') +
    (gap.last_order ? `. Senast ${gap.last_order}.` : '.') +
    ' Ingen order idag.'

  const markNoOrder = async () => {
    const ok = await confirmDialog({
      title: `Ingen beställning från ${gap.vendor}?`,
      message: `${locationName} beställer inget från ${gap.vendor} idag. Syns som "ingen beställning" på tavlan.`,
      confirmLabel: 'Ingen beställning',
    })
    if (!ok) return
    try {
      await noOrder.mutateAsync({ locationId: gap.location_id, employeeId: null, vendor: gap.vendor })
      qc.invalidateQueries({ queryKey: VENDOR_GAPS_KEY })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kunde inte spara')
    }
  }

  const hide = () => {
    dismiss.mutate({ locationId: gap.location_id, vendor: gap.vendor }, {
      onError: err => toast.error(err instanceof Error ? err.message : 'Kunde inte dölja'),
    })
  }

  const busy = dismiss.isPending || noOrder.isPending
  const tone = late
    ? 'border-red-300 dark:border-red-900 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300'
    : 'border-amber-300 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
  const iconBtn = 'p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50 transition-colors'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      title={explain}
      className={`rounded-2xl border border-dashed px-3 py-2 ${tone}`}
    >
      <div className="flex items-center gap-2">
        {late
          ? <AlertTriangle size={14} className="shrink-0" />
          : <Clock size={14} className="shrink-0" />}
        <span className="text-sm font-semibold truncate">{gap.vendor}</span>
        <span className="ml-auto flex items-center gap-0.5 -mr-1">
          <button onClick={markNoOrder} disabled={busy} title="Ingen beställning idag" aria-label="Ingen beställning idag" className={iconBtn}>
            {noOrder.isPending ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
          </button>
          <button onClick={hide} disabled={busy} title="Dölj idag" aria-label="Dölj idag" className={iconBtn}>
            {dismiss.isPending ? <Loader2 size={14} className="animate-spin" /> : <EyeOff size={14} />}
          </button>
        </span>
      </div>
      <div className="flex items-center gap-3 pl-[22px] mt-0.5 text-[10px] tabular-nums opacity-80">
        {gap.usual_time && (
          <span className="flex items-center gap-1" title={`Brukar komma runt ${gap.usual_time}`}>
            <Clock size={10} /> {gap.usual_time}
          </span>
        )}
        <span className="flex items-center gap-1" title={`Beställt ${gap.days_hit} av senaste ${gap.days_total} ${weekday}ar`}>
          <CalendarCheck size={10} /> {gap.days_hit}/{gap.days_total}
        </span>
      </div>
    </motion.div>
  )
}
