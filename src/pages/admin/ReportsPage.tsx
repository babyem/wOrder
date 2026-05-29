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

function formatKrCompact(n: number) {
  return Math.round(n).toLocaleString('sv-SE')
}

function formatDateShort(d: Date) {
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
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
    periods.forEach(p => {
      queryClient.refetchQueries({ queryKey: ['qopla-overview', p.start.toISOString(), p.end.toISOString()] })
    })
  }

  return (
    <div className="flex flex-col gap-4 h-full pb-20">
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

      <div className="overflow-x-auto -mx-4 md:-mx-6 px-4 md:px-6">
        <div className="flex gap-4 pb-4" style={{ minWidth: 'max-content' }}>
          {periods.map(p => (
            <PeriodColumn key={p.key} period={p} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PeriodColumn({ period }: { period: PeriodDef }) {
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
    <div className="w-72 flex-none flex flex-col gap-2">
      <div className="px-2 flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{period.label}</h2>
          {isFetching && !isLoading && <span className="text-[10px] text-indigo-500">…</span>}
        </div>
        <span className="text-[10px] text-slate-400">
          {formatDateShort(period.start)}–{formatDateShort(period.end)}
        </span>
      </div>

      <div className="relative z-10 bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Spinner size={18} />
          </div>
        )}
        {isError && <p className="text-xs text-red-400 px-2 py-2">Kunde inte hämta</p>}

        {data && (
          <div className="flex flex-col gap-0.5">
            {sorted.length === 0 ? (
              <p className="text-xs text-slate-400 py-2 px-2">Ingen data</p>
            ) : (
              sorted.map(s => <ShopRow key={s.shopId} shop={s} period={period} />)
            )}
            <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100 px-1.5 whitespace-nowrap">
              <span className="flex-1 text-[11px] font-semibold text-slate-600">Totalt</span>
              <span className="tabular-nums text-xs font-bold text-indigo-600 shrink-0">
                {formatKrCompact(totals.sales)} kr
              </span>
              <span className="tabular-nums text-[10px] text-slate-500 shrink-0 w-8 text-right">
                {totals.orders}
              </span>
              <span className="shrink-0 w-5" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ShopRow({ shop, period }: { shop: QoplaShopOverview; period: PeriodDef }) {
  const handleSie = (e: React.MouseEvent) => {
    e.stopPropagation()
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
    <div className="flex items-center gap-1.5 py-1 px-1.5 hover:bg-slate-50 rounded-lg whitespace-nowrap">
      <span className="flex-1 truncate text-xs text-slate-700">{shop.shopName}</span>
      <span className="tabular-nums text-xs font-semibold text-slate-800 shrink-0">
        {formatKrCompact(shop.totalSales)}
      </span>
      <span className="tabular-nums text-[10px] text-slate-500 shrink-0 w-8 text-right">
        {shop.totalOrders}
      </span>
      <button
        onClick={handleSie}
        title={`Ladda ned SIE för ${period.label}`}
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-indigo-500 hover:bg-indigo-50 transition-colors"
      >
        <Download size={11} />
      </button>
    </div>
  )
}
