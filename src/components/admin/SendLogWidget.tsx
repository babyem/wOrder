import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Mail, MessageSquare, ScrollText, CheckCircle2, XCircle } from 'lucide-react'
import Modal from '../ui/Modal'
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

function formatFull(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function recipient(e: SendLogEntry): string {
  return e.contact_label || e.contact_value
}

// Senaste utskicken till leverantörer — "Woso Izakai / Martin & Servera · Mail till Nassim".
// Klick på en rad öppnar meddelandet som skickades.
export function SendLogWidget() {
  const { data, isLoading, isError } = useSendLog(8)
  const [selected, setSelected] = useState<SendLogEntry | null>(null)

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
        <ul className="space-y-0.5 -mx-1">
          {data.map(e => {
            const Icon = e.channel === 'email' ? Mail : MessageSquare
            const verb = e.channel === 'email' ? 'Mail' : 'SMS'
            const where = e.location_names.join(', ')
            const failed = e.status === 'failed'
            return (
              <li key={e.id}>
                <button
                  onClick={() => setSelected(e)}
                  title="Visa vad som skickades"
                  className="w-full text-left text-xs leading-tight px-1 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700/60 transition-colors"
                >
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="tabular-nums text-slate-400 dark:text-zinc-500 shrink-0">{formatWhen(e.sent_at)}</span>
                    <span className="font-medium text-slate-700 dark:text-zinc-200 truncate">{where || e.vendor_name}</span>
                  </div>
                  <div className={`flex items-center gap-1 min-w-0 ${failed ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-zinc-400'}`}>
                    {failed
                      ? <XCircle size={10} className="shrink-0 text-red-500 dark:text-red-400" aria-label="Misslyckades" />
                      : <CheckCircle2 size={10} className="shrink-0 text-emerald-500 dark:text-emerald-400" aria-label="Skickat" />}
                    <Icon size={10} className={`shrink-0 ${e.channel === 'email' ? 'text-indigo-500 dark:text-indigo-400' : 'text-emerald-500 dark:text-emerald-400'}`} />
                    <span className="truncate">
                      {where ? <>{e.vendor_name} · </> : null}{verb} till {recipient(e)}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Portal: i mobilmenyn ligger widgeten inuti en transformerad drawer, där skulle
          en fixed modal annars fastna innanför drawerns 256px. */}
      {createPortal(
        <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.vendor_name ?? ''}>
          {selected && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-slate-400 dark:text-zinc-500">{selected.status === 'failed' ? 'Försök' : 'Skickat'}</dt>
                <dd className="text-slate-700 dark:text-zinc-200">{formatFull(selected.sent_at)}</dd>
                <dt className="text-slate-400 dark:text-zinc-500">Status</dt>
                <dd className={`flex items-center gap-1 font-medium ${selected.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {selected.status === 'failed'
                    ? <><XCircle size={12} /> Misslyckades</>
                    : <><CheckCircle2 size={12} /> Skickat</>}
                </dd>
                {selected.error && (
                  <>
                    <dt className="text-slate-400 dark:text-zinc-500">Fel</dt>
                    <dd className="text-red-600 dark:text-red-400 break-words">{selected.error}</dd>
                  </>
                )}
                {selected.location_names.length > 0 && (
                  <>
                    <dt className="text-slate-400 dark:text-zinc-500">Restaurang</dt>
                    <dd className="text-slate-700 dark:text-zinc-200">{selected.location_names.join(', ')}</dd>
                  </>
                )}
                <dt className="text-slate-400 dark:text-zinc-500">{selected.channel === 'email' ? 'Mail till' : 'SMS till'}</dt>
                <dd className="text-slate-700 dark:text-zinc-200">
                  {selected.contact_label
                    ? <>{selected.contact_label} <span className="text-slate-400 dark:text-zinc-500">· {selected.contact_value}</span></>
                    : selected.contact_value}
                </dd>
                {selected.subject && (
                  <>
                    <dt className="text-slate-400 dark:text-zinc-500">Ämne</dt>
                    <dd className="text-slate-700 dark:text-zinc-200">{selected.subject}</dd>
                  </>
                )}
              </dl>
              {selected.body
                ? <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 dark:text-zinc-100 bg-slate-50 dark:bg-zinc-800 rounded-xl p-3 max-h-[60vh] overflow-auto">{selected.body}</pre>
                : <p className="text-xs text-slate-400 dark:text-zinc-500 italic">Meddelandet sparades inte för det här utskicket.</p>}
            </div>
          )}
        </Modal>,
        document.body,
      )}
    </div>
  )
}
