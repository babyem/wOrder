import { useMemo, useState } from 'react'
import { Download, RefreshCw, ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import Spinner from '../../components/ui/Spinner'
import { useQoplaOverview, type QoplaShopOverview } from '../../plugins/qopla/useQoplaOverview'
import { useQoplaHourly } from '../../plugins/qopla/useQoplaHourly'
import toast from 'react-hot-toast'
import { usePosDailySales, useRunDinkassa, useRunAncon, type PosDailySale } from '../../hooks/useFortnox'

const dymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

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

const ZERO_SHOP = (id: string, name: string): QoplaShopOverview => ({
  shopId: id, shopName: name, totalSales: 0, totalOrders: 0, byChannel: {},
})

export default function ReportsPage() {
  const periods = useMemo(buildPeriods, [])
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // keys = `${periodKey}::${shopId}`
  const { data: posSales = [] } = usePosDailySales()

  // Canonical shop order from "month" data (sales DESC)
  const monthPeriod = periods.find(p => p.key === 'month')!
  const monthQuery = useQoplaOverview({
    startISO: monthPeriod.start.toISOString(),
    endISO: monthPeriod.end.toISOString(),
  })
  const canonicalOrder: { shopId: string; shopName: string }[] | null = useMemo(() => {
    if (!monthQuery.data) return null
    return [...monthQuery.data]
      .sort((a, b) => b.totalSales - a.totalSales)
      .map(s => ({ shopId: s.shopId, shopName: s.shopName }))
  }, [monthQuery.data])

  const handleSync = () => {
    periods.forEach(p => {
      queryClient.refetchQueries({ queryKey: ['qopla-overview', p.start.toISOString(), p.end.toISOString()] })
    })
    queryClient.refetchQueries({ queryKey: ['pos-daily-sales'] })
  }

  const toggleExpand = (periodKey: PeriodKey, shopId: string) => {
    const k = `${periodKey}::${shopId}`
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {periods.map(p => (
          <PeriodColumn
            key={p.key}
            period={p}
            canonicalOrder={canonicalOrder}
            expandedKeys={expanded}
            onToggleExpand={toggleExpand}
            posRows={posSales}
          />
        ))}
      </div>
    </div>
  )
}

interface PeriodColumnProps {
  period: PeriodDef
  canonicalOrder: { shopId: string; shopName: string }[] | null
  expandedKeys: Set<string>
  onToggleExpand: (periodKey: PeriodKey, shopId: string) => void
  posRows: PosDailySale[]
}

function PeriodColumn({ period, canonicalOrder, expandedKeys, onToggleExpand, posRows }: PeriodColumnProps) {
  const startISO = period.start.toISOString()
  const endISO = period.end.toISOString()
  const { data, isLoading, isError, isFetching } = useQoplaOverview({ startISO, endISO })
  const runDinkassa = useRunDinkassa()
  const runAncon = useRunAncon()
  const a = dymd(period.start), b = dymd(period.end)

  // Synced (non-live) shops with their period sales/orders.
  const syncedShops = useMemo(() => {
    const map = new Map<string, { id: string; name: string; source: string; sales: number; orders: number; synced: boolean }>()
    for (const r of posRows) {
      let e = map.get(r.qopla_shop_id)
      if (!e) { e = { id: r.qopla_shop_id, name: r.shop_name || r.qopla_shop_id, source: r.source, sales: 0, orders: 0, synced: false }; map.set(r.qopla_shop_id, e) }
      if (r.business_date >= a && r.business_date <= b) { e.sales += Number(r.sales); e.orders += Number(r.orders) || 0; e.synced = true }
    }
    return [...map.values()]
  }, [posRows, a, b])

  const chaoTotal = useMemo(
    () => syncedShops.reduce((acc, s) => ({ sales: acc.sales + s.sales, orders: acc.orders + s.orders }), { sales: 0, orders: 0 }),
    [syncedShops],
  )

  const [syncingId, setSyncingId] = useState<string | null>(null)

  // ancon TODAY intraday renders only in a real browser -> trigger the Playwright
  // Action (async ~1–2 min). Past ancon ranges + dinkassa use the server-side syncs.
  const syncShop = (shop: { id: string; name: string; source: string }) => {
    setSyncingId(shop.id)
    const done = () => setSyncingId(null)
    const onError = (e: unknown) => { toast.error((e as Error).message); done() }
    const args = { from: a, to: b }
    if (shop.source === 'ancon' && period.key !== 'today') {
      runAncon.mutate(args, { onSuccess: () => { toast.success(`${shop.name} synkad`); done() }, onError })
    } else {
      runDinkassa.mutate(args, { onSuccess: () => { toast.success(`Synkar ${shop.name} — klart om ~1–2 min`); done() }, onError })
    }
  }

  const totals = useMemo(() => {
    if (!data) return { sales: 0, orders: 0 }
    return data.reduce(
      (acc, s) => ({ sales: acc.sales + s.totalSales, orders: acc.orders + s.totalOrders }),
      { sales: 0, orders: 0 }
    )
  }, [data])

  // Render in canonical order. Fallback: own data sorted by sales.
  const ordered = useMemo(() => {
    if (!data) return []
    if (canonicalOrder) {
      const byId = new Map(data.map(s => [s.shopId, s]))
      const result = canonicalOrder.map(c => byId.get(c.shopId) ?? ZERO_SHOP(c.shopId, c.shopName))
      // Append any shops in data not in canonical
      for (const s of data) {
        if (!canonicalOrder.find(c => c.shopId === s.shopId)) result.push(s)
      }
      return result
    }
    return [...data].sort((a, b) => b.totalSales - a.totalSales)
  }, [data, canonicalOrder])

  const isDayPeriod = period.key === 'today' || period.key === 'yesterday'

  return (
    <div className="flex flex-col gap-2 min-w-0">
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
            {ordered.length === 0 ? (
              <p className="text-xs text-slate-400 py-2 px-2">Ingen data</p>
            ) : (
              ordered.map(s => (
                <ShopRowWithExpand
                  key={s.shopId}
                  shop={s}
                  period={period}
                  isExpanded={expandedKeys.has(`${period.key}::${s.shopId}`)}
                  canExpand={isDayPeriod}
                  onToggle={() => onToggleExpand(period.key, s.shopId)}
                />
              ))
            )}
            {syncedShops.map(sh => (
              <div key={sh.id} className="flex items-center gap-1.5 py-1 px-1.5 whitespace-nowrap">
                <span className="flex-1 truncate text-xs text-slate-700 flex items-center gap-1">
                  {sh.name} <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">synk</span>
                </span>
                <span className="tabular-nums text-xs font-semibold text-slate-800 shrink-0">
                  {sh.synced ? formatKrCompact(sh.sales) : '—'}
                </span>
                <span className="tabular-nums text-[10px] text-slate-500 shrink-0 w-8 text-right">{sh.orders || ''}</span>
                <button
                  onClick={() => syncShop(sh)}
                  disabled={syncingId === sh.id}
                  title={`Synka ${sh.name} för perioden`}
                  className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-indigo-500 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={11} className={syncingId === sh.id ? 'animate-spin' : ''} />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100 px-1.5 whitespace-nowrap">
              <span className="flex-1 text-[11px] font-semibold text-slate-600">Totalt</span>
              <span className="tabular-nums text-xs font-bold text-indigo-600 shrink-0">
                {formatKrCompact(totals.sales + chaoTotal.sales)} kr
              </span>
              <span className="tabular-nums text-[10px] text-slate-500 shrink-0 w-8 text-right">
                {totals.orders + chaoTotal.orders}
              </span>
              <span className="shrink-0 w-5" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ShopRowProps {
  shop: QoplaShopOverview
  period: PeriodDef
  isExpanded: boolean
  canExpand: boolean
  onToggle: () => void
}

function ShopRowWithExpand({ shop, period, isExpanded, canExpand, onToggle }: ShopRowProps) {
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
    <div className="flex flex-col">
      <div
        className={`flex items-center gap-1.5 py-1 px-1.5 rounded-lg whitespace-nowrap ${
          canExpand ? 'hover:bg-slate-50 cursor-pointer' : ''
        } ${isExpanded ? 'bg-slate-50' : ''}`}
        onClick={canExpand ? onToggle : undefined}
      >
        {canExpand && (
          <ChevronDown
            size={11}
            className={`shrink-0 text-slate-400 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
          />
        )}
        <span className={`flex-1 truncate text-xs text-slate-700 ${canExpand ? 'select-none' : ''}`}>
          {shop.shopName}
        </span>
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

      {isExpanded && canExpand && (
        <HourlyDetails shopId={shop.shopId} period={period} />
      )}
    </div>
  )
}

function HourlyDetails({ shopId, period }: { shopId: string; period: PeriodDef }) {
  const { data, isLoading, isError, error } = useQoplaHourly({
    shopId,
    startISO: period.start.toISOString(),
    endISO: period.end.toISOString(),
  })

  if (isLoading) {
    return (
      <div className="px-3 py-2 flex justify-center">
        <Spinner size={14} />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="px-3 py-2 text-[10px] text-red-400">
        {error instanceof Error ? error.message : 'Kunde inte hämta timme-data'}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return <div className="px-3 py-2 text-[10px] text-slate-400">Ingen timme-data</div>
  }

  const max = Math.max(...data.map(b => b.sales), 1)

  return (
    <div className="px-2 py-2 border-l-2 border-indigo-100 ml-1.5 mt-0.5 flex flex-col gap-0.5">
      {data.map(b => (
        <div key={b.hour} className="flex items-center gap-1.5 text-[10px] whitespace-nowrap">
          <span className="tabular-nums text-slate-400 shrink-0 w-7">{String(b.hour).padStart(2, '0')}:00</span>
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400"
              style={{ width: `${(b.sales / max) * 100}%` }}
            />
          </div>
          <span className="tabular-nums text-slate-700 font-medium shrink-0">
            {formatKrCompact(b.sales)}
          </span>
        </div>
      ))}
    </div>
  )
}
