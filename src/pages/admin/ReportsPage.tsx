import { useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaOverview, type QoplaShopOverview } from '../../plugins/qopla/useQoplaOverview'

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
      const day = (d.getDay() + 6) % 7
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

function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function safeName(s: string) {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')
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

  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQoplaOverview({ startISO, endISO })

  const totals = useMemo(() => {
    if (!data) return { sales: 0, orders: 0 }
    return data.reduce(
      (acc, s) => ({ sales: acc.sales + s.totalSales, orders: acc.orders + s.totalOrders }),
      { sales: 0, orders: 0 }
    )
  }, [data])

  const sorted = useMemo(() => {
    if (!data) return []
    return [...data].sort((a, b) => b.totalSales - a.totalSales)
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rapporter</h1>
          <p className="text-sm text-slate-500">
            {range.label} · {formatDate(range.start)} – {formatDate(range.end)}
          </p>
          {dataUpdatedAt > 0 && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Senast hämtad {new Date(dataUpdatedAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 transition-colors"
          title="Hämta senaste siffrorna"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Synkar…' : 'Synka'}
        </button>
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
        <div className="bg-white border border-slate-100 rounded-xl p-3">
          <div className="space-y-0.5">
            {sorted.map(s => (
              <ShopRow key={s.shopId} shop={s} range={range} />
            ))}
            <div className="flex items-center gap-2 mt-1 pt-1.5 border-t border-slate-100 px-2 whitespace-nowrap">
              <span className="flex-1 text-xs font-semibold text-slate-600">Totalt</span>
              <span className="tabular-nums text-xs font-bold text-indigo-600 shrink-0 w-24 text-right">{formatKr(totals.sales)}</span>
              <span className="tabular-nums text-[11px] text-slate-500 shrink-0 w-12 text-right">{totals.orders}</span>
              <span className="shrink-0 w-12" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ShopRow({ shop, range }: { shop: QoplaShopOverview; range: DateRange }) {
  const handleSie = () => {
    const fileName = `${safeName(shop.shopName)}_SIE${ymd(range.start)}-${ymd(range.end)}.se`
    const params = new URLSearchParams({
      action: 'sie',
      shopId: shop.shopId,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      name: fileName,
    })
    const url = `/api/qopla?${params.toString()}`
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-slate-50 rounded-lg whitespace-nowrap">
      <span className="flex-1 truncate text-sm text-slate-700">{shop.shopName}</span>
      <span className="tabular-nums text-sm font-semibold text-slate-800 shrink-0 w-24 text-right">
        {formatKr(shop.totalSales)}
      </span>
      <span className="tabular-nums text-[11px] text-slate-500 shrink-0 w-12 text-right">
        {shop.totalOrders}
      </span>
      <button
        onClick={handleSie}
        title={`Ladda ned SIE för ${range.label}`}
        className="shrink-0 inline-flex items-center justify-center gap-1 w-12 py-0.5 text-[10px] font-medium rounded text-indigo-600 hover:bg-indigo-50 transition-colors"
      >
        <Download size={10} />
        SIE
      </button>
    </div>
  )
}
