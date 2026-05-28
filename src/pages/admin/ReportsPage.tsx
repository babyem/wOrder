import { useMemo, useState } from 'react'
import { FileText, TrendingUp, Receipt, Package, Download } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaReports, type QoplaReport } from '../../plugins/qopla/useQoplaReports'
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
      const day = (d.getDay() + 6) % 7
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

// Period overlap — report's [startDate, endDate] crosses the filter range
function inRange(report: QoplaReport, range: DateRange) {
  const rs = new Date(report.startDate).getTime()
  const re = new Date(report.endDate).getTime()
  return rs <= range.end.getTime() && re >= range.start.getTime()
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
  const [reportType, setReportType] = useState<'X' | 'Z'>('X')

  const range = useMemo(() => computeRange(preset, customStart, customEnd), [preset, customStart, customEnd])

  const reportsQ = useQoplaReports({ reportType, pageItems: 100 })
  const overviewQ = useQoplaOverview({ startISO: range.start.toISOString(), endISO: range.end.toISOString() })

  const reportsInRange = useMemo(() => {
    if (!reportsQ.data) return []
    const all: { shopName: string; shopId: string; report: QoplaReport }[] = []
    for (const s of reportsQ.data) {
      for (const r of s.items) {
        if (inRange(r, range)) all.push({ shopName: s.shopName, shopId: s.shopId, report: r })
      }
    }
    return all.sort((a, b) => new Date(b.report.createdAt).getTime() - new Date(a.report.createdAt).getTime())
  }, [reportsQ.data, range])

  const totals = useMemo(() => {
    if (!overviewQ.data) return { sales: 0, orders: 0 }
    return overviewQ.data.reduce(
      (acc, s) => ({ sales: acc.sales + s.totalSales, orders: acc.orders + s.totalOrders }),
      { sales: 0, orders: 0 }
    )
  }, [overviewQ.data])

  const reportTotals = useMemo(() => {
    let receipts = 0, products = 0
    for (const { report } of reportsInRange) {
      receipts += report.sumReceipts || 0
      products += report.sumSoldProducts || 0
    }
    return { receipts, products }
  }, [reportsInRange])

  const handleSieDownload = (shopId: string, reportId: string, reportNumber: number) => {
    const params = new URLSearchParams({ action: 'sie', reportId, shopId })
    const url = `/api/qopla?${params.toString()}`
    // open in new tab so user sees error message inline if endpoint returns 404
    window.open(url, '_blank')
    // also start download via hidden link
    const a = document.createElement('a')
    a.href = url
    a.download = `zrapport-${reportNumber}.se`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const isLoading = reportsQ.isLoading || overviewQ.isLoading
  const isError = reportsQ.isError && overviewQ.isError

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
      {isError && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-4 text-sm">Kunde inte hämta data</div>}

      {overviewQ.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total brutto" value={formatKr(totals.sales)} icon={TrendingUp} color="text-indigo-600" bg="bg-indigo-50" />
            <StatCard label="Total order" value={totals.orders.toString()} icon={Receipt} color="text-emerald-600" bg="bg-emerald-50" />
            <StatCard label="Kvitton (rapport)" value={reportTotals.receipts.toString()} icon={Receipt} color="text-sky-600" bg="bg-sky-50" />
            <StatCard label="Produkter (rapport)" value={reportTotals.products.toString()} icon={Package} color="text-amber-600" bg="bg-amber-50" />
          </div>

          <Section title="Per restaurang" icon={FileText}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-3">Restaurang</th>
                    <th className="py-2 pr-3 text-right">Försäljning</th>
                    <th className="py-2 text-right">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {overviewQ.data
                    .slice()
                    .sort((a, b) => b.totalSales - a.totalSales)
                    .map(s => (
                      <tr key={s.shopId} className="border-b border-slate-50 last:border-0">
                        <td className="py-2 pr-3 text-slate-700">{s.shopName}</td>
                        <td className="py-2 pr-3 text-right font-semibold text-slate-800">{formatKr(s.totalSales)}</td>
                        <td className="py-2 text-right text-slate-500">{s.totalOrders}</td>
                      </tr>
                    ))}
                  <tr className="border-t-2 border-slate-200">
                    <td className="py-2 pr-3 font-semibold text-slate-700">Totalt</td>
                    <td className="py-2 pr-3 text-right font-bold text-indigo-600">{formatKr(totals.sales)}</td>
                    <td className="py-2 text-right font-bold text-slate-700">{totals.orders}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      {reportsQ.data && (
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
                    <th className="py-2 pr-3 text-right">Produkter</th>
                    {reportType === 'Z' && <th className="py-2 text-right">SIE</th>}
                  </tr>
                </thead>
                <tbody>
                  {reportsInRange.map(({ shopName, shopId, report }) => (
                    <tr key={report.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 pr-3 text-slate-500">{report.reportNumber}</td>
                      <td className="py-2 pr-3 text-slate-700">{shopName}</td>
                      <td className="py-2 pr-3 text-slate-500 text-[12px]">{formatDateTime(report.createdAt)}</td>
                      <td className="py-2 pr-3 text-right font-medium text-slate-800">{formatKr(report.totalSales)}</td>
                      <td className="py-2 pr-3 text-right text-slate-600">{formatKr(report.totalNetSales)}</td>
                      <td className="py-2 pr-3 text-right text-slate-500">{report.sumReceipts}</td>
                      <td className="py-2 pr-3 text-right text-slate-500">{report.sumSoldProducts}</td>
                      {reportType === 'Z' && (
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleSieDownload(shopId, report.id, report.reportNumber)}
                            title="Ladda ned SIE"
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <Download size={12} />
                            SIE
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
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
