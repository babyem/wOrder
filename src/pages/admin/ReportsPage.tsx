import { useMemo, useState } from 'react'
import { FileText, Download } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaOverview } from '../../plugins/qopla/useQoplaOverview'

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom'

interface DateRange {
  start: Date
  end: Date
  label: string
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d: Date) {
  const x = new Date(d)
  // Match Qopla UI: 23:59:59.000 (not .999) for endDate ISO
  x.setHours(23, 59, 59, 0)
  return x
}

function computeRange(preset: Preset, customStart?: string, customEnd?: string): DateRange {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now), label: 'Idag' }
    case 'yesterday': {
      const y = new Date(now); y.setDate(now.getDate() - 1)
      return { start: startOfDay(y), end: endOfDay(y), label: 'Igår' }
    }
    case 'week': {
      const d = new Date(now)
      const day = (d.getDay() + 6) % 7 // monday=0
      d.setDate(d.getDate() - day)
      return { start: startOfDay(d), end: endOfDay(now), label: 'Denna vecka' }
    }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { start: startOfDay(s), end: endOfDay(e), label: 'Denna månad' }
    }
    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: startOfDay(s), end: endOfDay(e), label: 'Föregående månad' }
    }
    case 'custom': {
      const s = customStart ? new Date(customStart) : startOfDay(now)
      const e = customEnd ? new Date(customEnd) : endOfDay(now)
      return { start: startOfDay(s), end: endOfDay(e), label: 'Anpassat' }
    }
  }
}

function formatKr(n: number) {
  return `${Math.round(n).toLocaleString('sv-SE')} kr`
}

function formatDate(d: Date) {
  return d.toLocaleDateString('sv-SE')
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Idag',
  yesterday: 'Igår',
  week: 'Denna vecka',
  month: 'Denna månad',
  lastMonth: 'Föregående månad',
  custom: 'Anpassat',
}

export default function ReportsPage() {
  const [preset, setPreset] = useState<Preset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd])
  const startISO = range.start.toISOString()
  const endISO = range.end.toISOString()

  const { data, isLoading, isError } = useQoplaOverview({ startISO, endISO })

  const totals = useMemo(() => {
    if (!data) return { sales: 0, orders: 0 }
    return data.reduce(
      (acc, s) => ({ sales: acc.sales + s.totalSales, orders: acc.orders + s.totalOrders }),
      { sales: 0, orders: 0 }
    )
  }, [data])

  const handleSie = (shopId: string, shopName: string) => {
    const params = new URLSearchParams({ action: 'sie', shopId, start: startISO, end: endISO })
    const url = `/api/qopla?${params.toString()}`
    const a = document.createElement('a')
    a.href = url
    const ym = `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`
    a.download = `${shopName.replace(/\s+/g, '-')}-${ym}.se`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rapporter</h1>
          <p className="text-sm text-slate-500">
            {range.label} · {formatDate(range.start)} – {formatDate(range.end)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              preset === p
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg"
            />
            <span className="text-slate-400">–</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="text-xs px-2 py-1.5 border border-slate-200 rounded-lg"
            />
          </div>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Spinner size={32} /></div>}
      {isError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm">Kunde inte hämta data</div>}

      {data && (
        <div className="bg-white border border-slate-100 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Per restaurang</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3">Restaurang</th>
                  <th className="py-2 pr-3 text-right">Försäljning</th>
                  <th className="py-2 pr-3 text-right">Order</th>
                  <th className="py-2 text-right">SIE</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .slice()
                  .sort((a, b) => b.totalSales - a.totalSales)
                  .map(s => (
                    <tr key={s.shopId} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 pr-3 text-slate-700 font-medium">{s.shopName}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatKr(s.totalSales)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-500">{s.totalOrders}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => handleSie(s.shopId, s.shopName)}
                          title={`Ladda ned SIE för ${range.label}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-indigo-600 hover:bg-indigo-50 transition-colors"
                        >
                          <Download size={12} />
                          SIE
                        </button>
                      </td>
                    </tr>
                  ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="py-2.5 pr-3 font-semibold text-slate-700">Totalt</td>
                  <td className="py-2.5 pr-3 text-right font-bold text-indigo-600">{formatKr(totals.sales)}</td>
                  <td className="py-2.5 pr-3 text-right font-bold text-slate-700">{totals.orders}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
