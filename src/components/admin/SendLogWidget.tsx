import { Mail, MessageSquare, ScrollText } from 'lucide-react'
import { useSendLog } from '../../hooks/useSendLog'
import type { SendLogEntry } from '../../lib/sendLog'

const TZ = 'Europe/Stockholm'

function stockholmDay(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

// Idag → bara klockslag, annars "12/9 14:32" så äldre rader inte ser ut som dagens.
function formatWhen(iso: string): string {
  const d = new Date(iso)
  const time = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  if (stockholmDay(d) === stockholmDay(new Date())) return time
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: 'numeric', month: 'numeric' }).format(d)
  return `${day} ${time}`
}

function recipient(e: SendLogEntry): string {
  return e.contact_label || e.contact_value
}

// Senaste utskicken till leverantörer — "Woso Izakai · Martin & Servera / Mail till Nassim".
export function SendLogWidget() {
  const { data, isLoading, isError } = useSendLog(8)

  return (
    <div className="mx-1 mt-3 mb-2 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-800 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <ScrollText size={13} className="text-indigo-500 dark:text-indigo-400" />
        <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Logg</span>
      </div>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" style={{ width: `${55 + i * 12}%` }} />
          ))}
        </div>
      )}

      {isError && <p className="text-xs text-red-400">Kunde inte hämta loggen</p>}

      {data && data.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-zinc-500">Inga utskick ännu</p>
      )}

      {data && data.length > 0 && (
        <ul className="space-y-1.5">
          {data.map(e => {
            const Icon = e.channel === 'email' ? Mail : MessageSquare
            const verb = e.channel === 'email' ? 'Mail' : 'SMS'
            const where = e.location_names.join(', ')
            return (
              <li key={e.id} className="text-xs leading-tight" title={`${e.contact_value}${where ? ` · ${where}` : ''}`}>
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="tabular-nums text-slate-400 dark:text-zinc-500 shrink-0">{formatWhen(e.sent_at)}</span>
                  <span className="font-medium text-slate-700 dark:text-zinc-200 truncate">{where || e.vendor_name}</span>
                </div>
                <div className="flex items-center gap-1 pl-[2.6rem] text-slate-500 dark:text-zinc-400 min-w-0">
                  <Icon size={10} className={`shrink-0 ${e.channel === 'email' ? 'text-indigo-500 dark:text-indigo-400' : 'text-emerald-500 dark:text-emerald-400'}`} />
                  <span className="truncate">
                    {where ? <>{e.vendor_name} · </> : null}{verb} till {recipient(e)}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
