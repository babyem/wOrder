import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Clock, Ban, EyeOff, Loader2 } from 'lucide-react'
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

// Liten chip under kolumnrubriken: "den här leverantören brukar beställas idag men
// saknas". Tryck öppnar en meny med Ingen beställning / Dölj idag. Försvinner av
// sig själv när ordern kommer in. Förklaringen ligger i tooltipen.
export default function VendorGapChip({ gap, locationName }: Props) {
  const qc = useQueryClient()
  const dismiss = useDismissGap()
  const noOrder = useSubmitNoOrder()
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)
  const late = gapIsLate(gap)
  const weekday = WEEKDAY.format(new Date())

  const explain = `${locationName} brukar beställa från ${gap.vendor} på ${weekday}ar` +
    ` (${gap.days_hit} av senaste ${gap.days_total})` +
    (gap.usual_time ? `, oftast runt ${gap.usual_time}` : '') +
    (gap.last_order ? `. Senast ${gap.last_order}.` : '.') +
    ' Ingen order idag.'

  const markNoOrder = async () => {
    setMenu(null)
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
    setMenu(null)
    dismiss.mutate({ locationId: gap.location_id, vendor: gap.vendor }, {
      onError: err => toast.error(err instanceof Error ? err.message : 'Kunde inte dölja'),
    })
  }

  // Pekarkoordinater är riktiga viewport-pixlar även inne i den CSS-zoomade tavlan
  const openMenu = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMenu({ top: (e.clientY || rect.bottom) + 6, left: e.clientX || rect.left })
  }

  const busy = dismiss.isPending || noOrder.isPending
  const tone = late
    ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950'
    : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950'

  return (
    <>
      <button
        onClick={openMenu}
        disabled={busy}
        title={explain}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-dashed text-[11px] font-semibold disabled:opacity-50 transition-colors ${tone}`}
      >
        {busy ? <Loader2 size={11} className="animate-spin" /> : late ? <AlertTriangle size={11} /> : <Clock size={11} />}
        <span className="truncate max-w-[120px]">{gap.vendor}</span>
      </button>
      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMenu(null)} />
          <div
            className="fixed z-[9999] bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[170px]"
            style={{ top: menu.top, left: menu.left }}
          >
            <div className="px-2.5 py-1 text-[10px] text-slate-400 dark:text-zinc-500 truncate">
              {gap.usual_time ? `Brukar ~${gap.usual_time} · ` : ''}{gap.days_hit}/{gap.days_total} {weekday}ar
            </div>
            <button onClick={markNoOrder} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors">
              <Ban size={13} /> Ingen beställning idag
            </button>
            <button onClick={hide} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-700 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors">
              <EyeOff size={13} /> Dölj idag
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
