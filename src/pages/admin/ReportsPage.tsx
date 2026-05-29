import { useMemo } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import Spinner from '../../components/ui/Spinner'
import { useQoplaOverview, type QoplaShopOverview } from '../../plugins/qopla/useQoplaOverview'

type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth'

interface PeriodDef {
  key: PeriodKey
  label: string
  start: Date
  end: Date
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

function buildPeriods(): PeriodDef[] {
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((weekStart.getDay() + 6) % 7))
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  return [
    { key: 'today', label: 'Idag', start: startOfDay(now), end: endOfDay(now) },
    { key: 'yesterday', label: 'Igår', start: startOfDay(yesterday), end: endOfDay(yesterday) },
    { key: 'week', label: 'Denna vecka', start: startOfDay(weekStart), end: endOfDay(now) },
    { key: 'month', label: 'Denna månad', start: startOfDay(monthStart), end: endOfDay(monthEnd) },
    { key: 'lastMonth', label: 'Föregående månad', start: startOfDay(lastMonthStart), end: endOfDay(lastMonthEnd) },
  ]
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

export default function ReportsPage() {
  const periods = useMemo(buildPeriods, [])
  const queryClient = useQueryClient()

  const handleSync = () => {
    queryClient.invalidateQueries({ queryKey: ['qopla-overview'] })
    periods.forEach(p => {
      queryClient.refetchQueries({ queryKey: ['qopla-overview', p.start.toISOString(), p.end.toISOString()] })
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rapporter</h1>
          <p className="text-sm text-slate-500">Alla perioder · alla restauranger</p>
        </div>
        <button
          onClick={handleSync}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
          title="Hämta senaste siffrorna"
        >
          <RefreshCw size={13} />
          Synka
        </button>
      </div>

      {periods.map(period => (
        <PeriodSection key={period.key} period={period} />
      ))}
    </div>
  )
}

function PeriodSection({ period }: { period: PeriodDef }) {
  const startISO = period.start.toISOString()
  const endISO = period.end.toISOString()
  const { data, isLoading, isError, isFetching } = useQoplaOverview({ startISO, endISO })

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
    <div className="bg-white border border-slate-100 rounded-xl p-3">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h2 className="text-sm font-semibold text-slate-700">{period.label}</h2>
        <span className="text-[11px] text-slate-400">
          {formatDate(period.start)} – {formatDate(period.end)}
          {isFetching && !isLoading && <span className="ml-2 text-indigo-500">synkar…</span>}
        </span>
      </div>

      {isLoading && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}
      {isError && <p className="text-xs text-red-400 px-2 py-2">Kunde inte hämta data</p>}

      {data && (
        <div className="space-y-0.5">
          {sorted.map(s => (
            <ShopRow key={s.shopId} shop={s} period={period} />
          ))}
          <div className="flex items-center gap-2 mt-1 pt-1.5 border-t border-slate-100 px-2 whitespace-nowrap">
            <span className="flex-1 text-xs font-semibold text-slate-600">Totalt</span>
            <span className="tabular-nums text-xs font-bold text-indigo-600 shrink-0 w-24 text-right">{formatKr(totals.sales)}</span>
            <span className="tabular-nums text-[11px] text-slate-500 shrink-0 w-12 text-right">{totals.orders}</span>
            <span className="shrink-0 w-12" />
          </div>
        </div>
      )}
    </div>
  )
}

function ShopRow({ shop, period }: { shop: QoplaShopOverview; period: PeriodDef }) {
  const handleSie = () => {
    const fileName = `${safeName(shop.shopName)}_SIE${ymd(period.start)}-${ymd(period.end)}.se`
    const params = new URLSearchParams({
      action: 'sie',
      shopId: shop.shopId,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
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
        title={`Ladda ned SIE för ${period.label}`}
        className="shrink-0 inline-flex items-center justify-center gap-1 w-12 py-0.5 text-[10px] font-medium rounded text-indigo-600 hover:bg-indigo-50 transition-colors"
      >
        <Download size={10} />
        SIE
      </button>
    </div>
  )
}
