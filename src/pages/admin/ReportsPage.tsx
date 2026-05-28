import { useMemo, useState } from 'react'
import { FileText, Download } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaOverview } from '../../plugins/qopla/useQoplaOverview'

type MonthChoice = 'current' | 'previous'

interface MonthRange {
  start: Date
  end: Date
  label: string
}

function computeMonthRange(choice: MonthChoice): MonthRange {
  const now = new Date()
  if (choice === 'current') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end, label: monthLabel(start) }
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  return { start, end, label: monthLabel(start) }
}

function monthLabel(d: Date) {
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' })
}

function formatKr(n: number) {
  return `${Math.round(n).toLocaleString('sv-SE')} kr`
}

function formatDate(d: Date) {
  return d.toLocaleDateString('sv-SE')
}

export default function ReportsPage() {
  const [choice, setChoice] = useState<MonthChoice>('current')
  const range = useMemo(() => computeMonthRange(choice), [choice])
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
          <h1 className="text-2xl font-bold text-slate-900">Månadsrapport</h1>
          <p className="text-sm text-slate-500 capitalize">
            {range.label} · {formatDate(range.start)} – {formatDate(range.end)}
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['current', 'previous'] as MonthChoice[]).map(c => (
            <button
              key={c}
              onClick={() => setChoice(c)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                choice === c ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {c === 'current' ? 'Denna månad' : 'Föregående månad'}
            </button>
          ))}
        </div>
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
