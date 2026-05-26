import { useState } from 'react'
import { useQoplaSales } from './useQoplaSales'

export function QoplaSalesWidget() {
  const [daysAgo, setDaysAgo] = useState(0)
  const { data, isLoading, isError } = useQoplaSales(daysAgo)

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
              daysAgo === 0
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Idag
          </button>
          <button
            onClick={() => setDaysAgo(1)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
              daysAgo === 1
                ? 'bg-indigo-100 text-indigo-600'
                : 'text-slate-400 hover:text-slate-600'
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
    </div>
  )
}
