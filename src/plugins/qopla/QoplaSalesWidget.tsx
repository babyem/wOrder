import { useState } from 'react'
import toast from 'react-hot-toast'
import { useQoplaSales } from './useQoplaSales'
import { usePosDailySales, useRunDinkassa } from '../../hooks/useFortnox'

function stockholmDate(daysAgo: number): string {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (!daysAgo) return s
  const [y, m, d] = s.split('-').map(Number)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.UTC(y, m - 1, d - daysAgo)))
}

export function QoplaSalesWidget() {
  const [daysAgo, setDaysAgo] = useState(0)
  const { data, isLoading, isError } = useQoplaSales(daysAgo)
  const { data: posSales = [] } = usePosDailySales()
  const runDinkassa = useRunDinkassa()

  const targetDate = stockholmDate(daysAgo)
  const dinkassa = posSales.filter(p => p.source === 'dinkassa')
  const chaoRows = dinkassa.filter(p => p.business_date === targetDate)
  const chaoSales = chaoRows.reduce((s, r) => s + Number(r.sales), 0)
  const chaoLatest = dinkassa[0] // most recent (query sorted desc)

  const handleSync = () => {
    runDinkassa.mutate({ from: targetDate, to: targetDate }, {
      onSuccess: () => toast.success('Synkar Chao från dinkassa — klart om ~1–2 min'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  return (
    <div className="mx-1 mt-6 mb-2 rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#6366f1' }}>
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
            <polyline points="17 6 23 6 23 12" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {daysAgo === 0 ? 'Idag' : 'Igår'}
          </span>
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setDaysAgo(0)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
              daysAgo === 0 ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Idag
          </button>
          <button
            onClick={() => setDaysAgo(1)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
              daysAgo === 1 ? 'bg-indigo-100 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Igår
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-slate-200 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
          ))}
        </div>
      )}

      {isError && <p className="text-xs text-red-400">Kunde inte hämta data</p>}

      {data && (
        <div className="space-y-1.5">
          {data.map(r => (
            <div key={r.shopId} className="flex justify-between items-baseline gap-1">
              <span className="text-xs text-slate-500 truncate">{r.restaurant}</span>
              <span className="text-xs font-semibold text-slate-700 shrink-0">
                {r.sales.toLocaleString('sv-SE')} kr
              </span>
            </div>
          ))}
          <div className="border-t border-slate-200 pt-1.5 mt-1.5 flex justify-between items-baseline">
            <span className="text-xs font-semibold text-slate-600">Totalt</span>
            <span className="text-xs font-bold" style={{ color: '#4f46e5' }}>
              {data.reduce((s, r) => s + r.sales, 0).toLocaleString('sv-SE')} kr
            </span>
          </div>
        </div>
      )}

      {/* Chao (dinkassa) — synced via the sync button, not live */}
      <div className="border-t border-slate-200 mt-2 pt-2">
        <div className="flex justify-between items-center gap-1">
          <span className="text-xs text-slate-500 truncate flex items-center gap-1">
            Chao
            <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">synk</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {chaoRows.length
              ? <span className="text-xs font-semibold text-slate-700">{chaoSales.toLocaleString('sv-SE')} kr</span>
              : <span className="text-xs text-slate-400">—</span>}
            <button
              onClick={handleSync}
              disabled={runDinkassa.isPending}
              title="Synka Chao från dinkassa"
              className="p-0.5 rounded text-indigo-500 hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={runDinkassa.isPending ? 'animate-spin' : ''}>
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>
        {chaoRows.length === 0 && chaoLatest && (
          <div className="text-[9px] text-slate-400 mt-0.5">
            Senast synkad: {chaoLatest.business_date} · {Number(chaoLatest.sales).toLocaleString('sv-SE')} kr
          </div>
        )}
      </div>
    </div>
  )
}
