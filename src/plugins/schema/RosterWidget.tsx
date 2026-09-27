import { useState } from 'react'
import { Users } from 'lucide-react'
import { schemaSupabase } from './schemaClient'
import { stockholmDate, useRoster, type ShiftTone } from './useRoster'

// Schema-appens färger (src/lib/shiftTones.ts) översatta till wOrders palett.
const TONE_DOT: Record<ShiftTone, string> = {
  neutral: 'bg-slate-300 dark:bg-zinc-600',
  brand: 'bg-teal-500',
  info: 'bg-sky-500',
  accent: 'bg-violet-500',
  warning: 'bg-amber-400',
  success: 'bg-emerald-500',
  danger: 'bg-red-500',
}

/** "10:00" → "10", "11:30" → "11:30" — samma korta tider som i Schema. */
const shortTime = (t: string) => {
  const [h, m] = t.split(':')
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`
}

const firstName = (name: string) => name.split(' ')[0]

// Vem som jobbar i dag / i morgon, hämtat från Schema-appen (TodayRoster där).
export function RosterWidget() {
  const [daysAhead, setDaysAhead] = useState<0 | 1>(0)
  const { data, isLoading, isError } = useRoster(stockholmDate(daysAhead))

  if (!schemaSupabase) return null

  return (
    <div className="mx-1 mt-3 mb-2 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Users size={13} className="text-indigo-500 dark:text-indigo-400" />
        <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Personal</span>
      </div>

      <div className="mb-2 flex items-center gap-0.5 rounded-lg bg-white dark:bg-zinc-900 p-0.5">
        {([0, 1] as const).map(value => (
          <button
            key={value}
            onClick={() => setDaysAhead(value)}
            aria-pressed={daysAhead === value}
            className={`flex-1 rounded-md py-1 text-xs font-semibold transition-colors ${
              daysAhead === value
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200'
            }`}
          >
            {value === 0 ? 'I dag' : 'I morgon'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" style={{ width: `${55 + i * 12}%` }} />
          ))}
        </div>
      )}

      {isError && <p className="text-xs text-red-400">Kunde inte hämta schemat</p>}

      {data && data.length === 0 && (
        <p className="px-1 py-2 text-xs text-slate-400 dark:text-zinc-500">
          Inga pass {daysAhead === 0 ? 'i dag' : 'i morgon'}.
        </p>
      )}

      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map(group => (
            <div key={group.restaurantId}>
              <p className="truncate text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-zinc-500">
                {group.restaurantName}
              </p>
              <ul className="mt-0.5">
                {group.rows.map(row => (
                  <li
                    key={row.id}
                    title={`${row.name} · ${shortTime(row.start)}–${shortTime(row.end)}`}
                    className="flex items-center gap-1.5 px-1 py-0.5 text-xs"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[row.tone]}`} />
                    <span className="truncate font-medium text-slate-700 dark:text-zinc-200">{firstName(row.name)}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-slate-400 dark:text-zinc-500">
                      {shortTime(row.start)}–{shortTime(row.end)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
