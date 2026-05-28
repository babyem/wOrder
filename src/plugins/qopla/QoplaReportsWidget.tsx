import { useState } from 'react'
import { useQoplaReports, aggregateCategorySales, type QoplaReportType } from './useQoplaReports'

type Tab = 'X' | 'Z' | 'CAT'

const TAB_LABEL: Record<Tab, string> = {
  X: 'X-rapport',
  Z: 'Z-rapport',
  CAT: 'Kategori',
}

function formatKr(n: number) {
  return `${Math.round(n).toLocaleString('sv-SE')} kr`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
}

export function QoplaReportsWidget() {
  const [tab, setTab] = useState<Tab>('X')
  const reportType: QoplaReportType = tab === 'Z' ? 'Z' : 'X'
  const { data, isLoading, isError } = useQoplaReports({ reportType, pageItems: 1 })

  return (
    <div className="mx-1 mt-3 mb-2 rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#0ea5e9' }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Rapporter
          </span>
        </div>
      </div>

      <div className="flex gap-1 mb-2.5">
        {(['X', 'Z', 'CAT'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
              tab === t
                ? 'bg-sky-100 text-sky-600'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-slate-200 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
          ))}
        </div>
      )}

      {isError && <p className="text-xs text-red-400">Kunde inte hämta data</p>}

      {data && tab !== 'CAT' && (
        <div className="space-y-2">
          {data.map(shop => {
            const latest = shop.items[0]
            if (!latest) {
              return (
                <div key={shop.shopId} className="text-xs text-slate-400">
                  <div className="font-medium text-slate-500">{shop.shopName}</div>
                  <div>Ingen rapport</div>
                </div>
              )
            }
            return (
              <div key={shop.shopId} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between items-baseline gap-1">
                  <span className="text-xs font-medium text-slate-600 truncate">{shop.shopName}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">#{latest.reportNumber}</span>
                </div>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-[10px] text-slate-400">Netto</span>
                  <span className="text-xs font-bold" style={{ color: '#0284c7' }}>{formatKr(latest.totalNetSales)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-slate-400">Brutto</span>
                  <span className="text-[11px] text-slate-600">{formatKr(latest.totalSales)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] text-slate-400">Kvitton / Produkter</span>
                  <span className="text-[11px] text-slate-500">{latest.sumReceipts} / {latest.sumSoldProducts}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">{formatDateTime(latest.createdAt)}</div>
              </div>
            )
          })}
        </div>
      )}

      {data && tab === 'CAT' && (() => {
        const cats = aggregateCategorySales(data)
        const total = cats.reduce((s, c) => s + c.totalSales, 0)
        if (!cats.length) return <p className="text-xs text-slate-400">Ingen kategoridata</p>
        return (
          <div className="space-y-1.5">
            {cats.map(c => (
              <div key={c.categoryName} className="flex justify-between items-baseline gap-1">
                <span className="text-xs text-slate-500 truncate">{c.categoryName}</span>
                <span className="text-xs font-semibold text-slate-700 shrink-0">{formatKr(c.totalSales)}</span>
              </div>
            ))}
            <div className="border-t border-slate-200 pt-1.5 mt-1.5 flex justify-between items-baseline">
              <span className="text-xs font-semibold text-slate-600">Totalt</span>
              <span className="text-xs font-bold" style={{ color: '#0284c7' }}>{formatKr(total)}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
