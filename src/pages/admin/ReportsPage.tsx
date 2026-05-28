import { useMemo, useState } from 'react'
import { FileText, TrendingUp, Receipt, Package, CreditCard, Tag } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaReports, type QoplaReport, type QoplaShopReports } from '../../plugins/qopla/useQoplaReports'

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
  x.setHours(23, 59, 59, 999)
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
      return { start: startOfDay(s), end: endOfDay(now), label: 'Denna månad' }
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE')
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
}

function inRange(report: QoplaReport, range: DateRange) {
  const t = new Date(report.endDate).getTime()
  return t >= range.start.getTime() && t <= range.end.getTime()
}

interface Aggregated {
  totalSales: number
  totalNetSales: number
  sumReceipts: number
  sumSoldProducts: number
  tip: number
  byCategory: { categoryName: string; totalSales: number }[]
  byPaymentMethod: { paymentMethod: string; amount: number; tip: number }[]
  byShop: { shopId: string; shopName: string; totalSales: number; totalNetSales: number; reportCount: number }[]
  byVat: { vatRate: number; net: number; vat: number }[]
}

function aggregate(shops: QoplaShopReports[], range: DateRange): Aggregated {
  const result: Aggregated = {
    totalSales: 0, totalNetSales: 0, sumReceipts: 0, sumSoldProducts: 0, tip: 0,
    byCategory: [], byPaymentMethod: [], byShop: [], byVat: [],
  }
  const cat = new Map<string, number>()
  const pay = new Map<string, { amount: number; tip: number }>()
  const shop = new Map<string, { name: string; sales: number; net: number; count: number }>()
  const vat = new Map<number, { net: number; vat: number }>()

  for (const s of shops) {
    for (const r of s.items) {
      if (!inRange(r, range)) continue
      result.totalSales += r.totalSales || 0
      result.totalNetSales += r.totalNetSales || 0
      result.sumReceipts += r.sumReceipts || 0
      result.sumSoldProducts += r.sumSoldProducts || 0
      result.tip += r.tip || 0

      for (const c of r.categoryTotalSales || []) {
        cat.set(c.categoryName, (cat.get(c.categoryName) ?? 0) + c.totalSales)
      }
      for (const p of r.paymentMethodAndAmounts || []) {
        const prev = pay.get(p.paymentMethod) ?? { amount: 0, tip: 0 }
        pay.set(p.paymentMethod, { amount: prev.amount + p.amount, tip: prev.tip + p.tip })
      }
      const prevShop = shop.get(s.shopId) ?? { name: s.shopName, sales: 0, net: 0, count: 0 }
      shop.set(s.shopId, {
        name: s.shopName,
        sales: prevShop.sales + r.totalSales,
        net: prevShop.net + r.totalNetSales,
        count: prevShop.count + 1,
      })
      for (const v of r.vatRatesAndNetAmounts || []) {
        const prev = vat.get(v.vatRate) ?? { net: 0, vat: 0 }
        vat.set(v.vatRate, { net: prev.net + v.amount, vat: prev.vat })
      }
      for (const v of r.vatRateAmountWithRefunds || []) {
        const prev = vat.get(v.vatRate) ?? { net: 0, vat: 0 }
        vat.set(v.vatRate, { net: prev.net, vat: prev.vat + v.amount })
      }
    }
  }

  result.byCategory = [...cat.entries()]
    .map(([categoryName, totalSales]) => ({ categoryName, totalSales }))
    .sort((a, b) => b.totalSales - a.totalSales)
  result.byPaymentMethod = [...pay.entries()]
    .map(([paymentMethod, v]) => ({ paymentMethod, amount: v.amount, tip: v.tip }))
    .sort((a, b) => b.amount - a.amount)
  result.byShop = [...shop.entries()]
    .map(([shopId, v]) => ({ shopId, shopName: v.name, totalSales: v.sales, totalNetSales: v.net, reportCount: v.count }))
    .sort((a, b) => b.totalSales - a.totalSales)
  result.byVat = [...vat.entries()]
    .map(([vatRate, v]) => ({ vatRate, net: v.net, vat: v.vat }))
    .sort((a, b) => b.vatRate - a.vatRate)

  return result
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
  const [preset, setPreset] = useState<Preset>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [reportType, setReportType] = useState<'X' | 'Z'>('Z')

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd])
  const { data, isLoading, isError } = useQoplaReports({ reportType, pageItems: 100 })

  const agg = useMemo(() => (data ? aggregate(data, range) : null), [data, range])

  const reportsInRange = useMemo(() => {
    if (!data) return []
    const all: { shopName: string; report: QoplaReport }[] = []
    for (const s of data) {
      for (const r of s.items) {
        if (inRange(r, range)) all.push({ shopName: s.shopName, report: r })
      }
    }
    return all.sort((a, b) => new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime())
  }, [data, range])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Rapporter</h1>
          <p className="text-sm text-slate-500">
            {range.label} · {formatDate(range.start.toISOString())} – {formatDate(range.end.toISOString())}
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['X', 'Z'] as const).map(t => (
            <button
              key={t}
              onClick={() => setReportType(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                reportType === t ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}-rapport
            </button>
          ))}
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
      {isError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm">Kunde inte hämta rapporter</div>}

      {agg && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Brutto" value={formatKr(agg.totalSales)} icon={TrendingUp} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="Netto" value={formatKr(agg.totalNetSales)} icon={TrendingUp} color="text-emerald-600" bg="bg-emerald-50" />
            <StatCard label="Kvitton" value={agg.sumReceipts.toString()} icon={Receipt} color="text-sky-600" bg="bg-sky-50" />
            <StatCard label="Produkter" value={agg.sumSoldProducts.toString()} icon={Package} color="text-amber-600" bg="bg-amber-50" />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Section title="Per restaurang" icon={FileText}>
              {agg.byShop.length === 0 ? <Empty /> : (
                <ul className="divide-y divide-slate-100">
                  {agg.byShop.map(s => (
                    <li key={s.shopId} className="py-2 flex justify-between items-baseline">
                      <div>
                        <div className="text-sm font-medium text-slate-700">{s.shopName}</div>
                        <div className="text-[11px] text-slate-400">{s.reportCount} rapporter · netto {formatKr(s.totalNetSales)}</div>
                      </div>
                      <span className="text-sm font-bold text-indigo-600">{formatKr(s.totalSales)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Kategoriförsäljning" icon={Tag}>
              {agg.byCategory.length === 0 ? <Empty /> : (
                <ul className="divide-y divide-slate-100">
                  {agg.byCategory.map(c => (
                    <li key={c.categoryName} className="py-2 flex justify-between items-baseline">
                      <span className="text-sm text-slate-600 truncate">{c.categoryName}</span>
                      <span className="text-sm font-semibold text-slate-800">{formatKr(c.totalSales)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Betalsätt" icon={CreditCard}>
              {agg.byPaymentMethod.length === 0 ? <Empty /> : (
                <ul className="divide-y divide-slate-100">
                  {agg.byPaymentMethod.map(p => (
                    <li key={p.paymentMethod} className="py-2 flex justify-between items-baseline">
                      <div>
                        <div className="text-sm text-slate-600">{p.paymentMethod}</div>
                        {p.tip > 0 && <div className="text-[11px] text-slate-400">dricks {formatKr(p.tip)}</div>}
                      </div>
                      <span className="text-sm font-semibold text-slate-800">{formatKr(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Moms" icon={Receipt}>
              {agg.byVat.length === 0 ? <Empty /> : (
                <ul className="divide-y divide-slate-100">
                  {agg.byVat.map(v => (
                    <li key={v.vatRate} className="py-2 flex justify-between items-baseline">
                      <span className="text-sm text-slate-600">{v.vatRate}%</span>
                      <span className="text-sm text-slate-500">
                        Netto {formatKr(v.net)} · Moms <span className="font-semibold text-slate-800">{formatKr(v.vat)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title={`${reportType}-rapporter (${reportsInRange.length})`} icon={FileText}>
            {reportsInRange.length === 0 ? <Empty text="Inga rapporter i perioden" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Restaurang</th>
                      <th className="py-2 pr-3">Skapad</th>
                      <th className="py-2 pr-3 text-right">Brutto</th>
                      <th className="py-2 pr-3 text-right">Netto</th>
                      <th className="py-2 pr-3 text-right">Kvitton</th>
                      <th className="py-2 text-right">Produkter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsInRange.map(({ shopName, report }) => (
                      <tr key={report.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 pr-3 text-slate-500">{report.reportNumber}</td>
                        <td className="py-2 pr-3 text-slate-700">{shopName}</td>
                        <td className="py-2 pr-3 text-slate-500 text-[12px]">{formatDateTime(report.createdAt)}</td>
                        <td className="py-2 pr-3 text-right font-medium text-slate-800">{formatKr(report.totalSales)}</td>
                        <td className="py-2 pr-3 text-right text-slate-600">{formatKr(report.totalNetSales)}</td>
                        <td className="py-2 pr-3 text-right text-slate-500">{report.sumReceipts}</td>
                        <td className="py-2 text-right text-slate-500">{report.sumSoldProducts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color, bg }: { label: string; value: string; icon: typeof TrendingUp; color: string; bg: string }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${bg}`}>
          <Icon size={14} className={color} />
        </div>
      </div>
      <div className="text-xl font-bold text-slate-900">{value}</div>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof FileText; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className="text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function Empty({ text = 'Ingen data' }: { text?: string }) {
  return <p className="text-xs text-slate-400 py-2">{text}</p>
}
