import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Mail, MessageSquare, ScrollText, CheckCircle2, XCircle, ChevronRight } from 'lucide-react'
import Modal from '../ui/Modal'
import Spinner from '../ui/Spinner'
import { useSendLog } from '../../hooks/useSendLog'
import type { SendLogEntry } from '../../lib/sendLog'

const TZ = 'Europe/Stockholm'

function stockholmDay(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function stockholmTime(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

const todayKey = () => stockholmDay(new Date())
const yesterdayKey = () => stockholmDay(new Date(Date.now() - 86_400_000))

// Idag → bara klockslag, igår → "Igår 14:32", äldre → "12/9 14:32".
function formatWhen(iso: string): string {
  const d = new Date(iso)
  const day = stockholmDay(d)
  if (day === todayKey()) return stockholmTime(d)
  if (day === yesterdayKey()) return `Igår ${stockholmTime(d)}`
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: 'numeric', month: 'numeric' }).format(d)
  return `${date} ${stockholmTime(d)}`
}

function formatFull(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

// Rubrik per dag i historiken: "Idag", "Igår", annars "ons 24 sep".
function dayHeading(day: string): string {
  if (day === todayKey()) return 'Idag'
  if (day === yesterdayKey()) return 'Igår'
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`))
}

function recipient(e: SendLogEntry): string {
  return e.contact_label || e.contact_value
}

function StatusIcons({ e, size = 11 }: { e: SendLogEntry; size?: number }) {
  const Icon = e.channel === 'email' ? Mail : MessageSquare
  return (
    <>
      <Icon size={size} className={`shrink-0 ${e.channel === 'email' ? 'text-indigo-500 dark:text-indigo-400' : 'text-emerald-500 dark:text-emerald-400'}`} />
      {e.status === 'failed'
        ? <XCircle size={size} className="shrink-0 text-red-500 dark:text-red-400" aria-label="Misslyckades" />
        : <CheckCircle2 size={size} className="shrink-0 text-emerald-500 dark:text-emerald-400" aria-label="Skickat" />}
    </>
  )
}

// Senaste utskicken till leverantörer — "12:40 ✉ ✓ / Martin & Servera". Widgeten visar
// bara idag och igår; klick på rubriken öppnar hela historiken, klick på en rad meddelandet.
export function SendLogWidget() {
  const { data, isLoading, isError } = useSendLog({ sinceHours: 48 })
  const [selected, setSelected] = useState<SendLogEntry | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const recent = (data ?? []).filter(e => {
    const day = stockholmDay(new Date(e.sent_at))
    return day === todayKey() || day === yesterdayKey()
  })

  return (
    <div className="mx-1 mt-3 mb-2 rounded-xl bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-800 p-3">
      <button
        onClick={() => setHistoryOpen(true)}
        title="Visa hela loggen"
        className="w-full flex items-center gap-1.5 mb-2 -mx-1 px-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700/60 transition-colors"
      >
        <ScrollText size={13} className="text-indigo-500 dark:text-indigo-400" />
        <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Logg</span>
        <ChevronRight size={12} className="ml-auto text-slate-300 dark:text-zinc-600" />
      </button>

      {isLoading && (
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-3 bg-slate-200 dark:bg-zinc-700 rounded animate-pulse" style={{ width: `${55 + i * 12}%` }} />
          ))}
        </div>
      )}

      {isError && <p className="text-xs text-red-400">Kunde inte hämta loggen</p>}

      {data && recent.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-zinc-500">Inga utskick idag eller igår</p>
      )}

      {recent.length > 0 && (
        <ul className="space-y-0.5 -mx-1">
          {recent.map(e => {
            const failed = e.status === 'failed'
            const where = e.location_names.join(', ')
            return (
              <li key={e.id}>
                <button
                  onClick={() => setSelected(e)}
                  title={`${where ? `${where} · ` : ''}${e.channel === 'email' ? 'Mail' : 'SMS'} till ${recipient(e)}${failed && e.error ? ` · ${e.error}` : ''}`}
                  className="w-full text-left text-xs leading-tight px-1 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-700/60 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="tabular-nums text-slate-400 dark:text-zinc-500">{formatWhen(e.sent_at)}</span>
                    <StatusIcons e={e} />
                  </div>
                  <div className={`truncate font-medium ${failed ? 'text-red-500 dark:text-red-400' : 'text-slate-700 dark:text-zinc-200'}`}>
                    {e.vendor_name}
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
        <>
          <SendLogHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} onSelect={setSelected} />
          <SendLogDetailModal entry={selected} onClose={() => setSelected(null)} />
        </>,
        document.body,
      )}
    </div>
  )
}

// Hela historiken, grupperad per dag. Hämtas först när modalen öppnas.
function SendLogHistoryModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (e: SendLogEntry) => void }) {
  const { data, isLoading, isError } = useSendLog({ limit: 300, enabled: open })

  const groups: { day: string; entries: SendLogEntry[] }[] = []
  for (const e of data ?? []) {
    const day = stockholmDay(new Date(e.sent_at))
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.entries.push(e)
    else groups.push({ day, entries: [e] })
  }

  return (
    <Modal open={open} onClose={onClose} title="Logg" maxWidth="max-w-md">
      <div className="-m-6 max-h-[70vh] overflow-auto">
        {isLoading && <div className="flex justify-center py-8"><Spinner size={24} /></div>}
        {isError && <p className="p-6 text-sm text-red-500">Kunde inte hämta loggen</p>}
        {data && data.length === 0 && <p className="p-6 text-sm text-slate-400 dark:text-zinc-500">Inga utskick ännu</p>}
        {groups.map(g => (
          <div key={g.day}>
            <div className="sticky top-0 bg-slate-50 dark:bg-zinc-800 px-6 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400 border-y border-slate-100 dark:border-zinc-800">
              {dayHeading(g.day)}
            </div>
            <ul>
              {g.entries.map(e => {
                const failed = e.status === 'failed'
                const where = e.location_names.join(', ')
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => onSelect(e)}
                      className="w-full text-left flex items-center gap-3 px-6 py-2 hover:bg-slate-50 dark:hover:bg-zinc-800/60 transition-colors"
                    >
                      <span className="tabular-nums text-xs text-slate-400 dark:text-zinc-500 w-10 shrink-0">{stockholmTime(new Date(e.sent_at))}</span>
                      <span className="flex items-center gap-1 shrink-0"><StatusIcons e={e} size={12} /></span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-medium truncate ${failed ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-zinc-100'}`}>
                          {e.vendor_name}
                        </span>
                        <span className="block text-xs text-slate-400 dark:text-zinc-500 truncate">
                          {where ? `${where} · ` : ''}{recipient(e)}{failed && e.error ? ` · ${e.error}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function SendLogDetailModal({ entry, onClose }: { entry: SendLogEntry | null; onClose: () => void }) {
  return (
    <Modal open={entry !== null} onClose={onClose} title={entry?.vendor_name ?? ''}>
      {entry && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-slate-400 dark:text-zinc-500">{entry.status === 'failed' ? 'Försök' : 'Skickat'}</dt>
            <dd className="text-slate-700 dark:text-zinc-200">{formatFull(entry.sent_at)}</dd>
            <dt className="text-slate-400 dark:text-zinc-500">Status</dt>
            <dd className={`flex items-center gap-1 font-medium ${entry.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {entry.status === 'failed'
                ? <><XCircle size={12} /> Misslyckades</>
                : <><CheckCircle2 size={12} /> Skickat</>}
            </dd>
            {entry.error && (
              <>
                <dt className="text-slate-400 dark:text-zinc-500">Fel</dt>
                <dd className="text-red-600 dark:text-red-400 break-words">{entry.error}</dd>
              </>
            )}
            {entry.location_names.length > 0 && (
              <>
                <dt className="text-slate-400 dark:text-zinc-500">Restaurang</dt>
                <dd className="text-slate-700 dark:text-zinc-200">{entry.location_names.join(', ')}</dd>
              </>
            )}
            <dt className="text-slate-400 dark:text-zinc-500">{entry.channel === 'email' ? 'Mail till' : 'SMS till'}</dt>
            <dd className="text-slate-700 dark:text-zinc-200">
              {entry.contact_label
                ? <>{entry.contact_label} <span className="text-slate-400 dark:text-zinc-500">· {entry.contact_value}</span></>
                : entry.contact_value}
            </dd>
            {entry.subject && (
              <>
                <dt className="text-slate-400 dark:text-zinc-500">Ämne</dt>
                <dd className="text-slate-700 dark:text-zinc-200">{entry.subject}</dd>
              </>
            )}
          </dl>
          {entry.body
            ? <pre className="whitespace-pre-wrap font-sans text-sm text-slate-800 dark:text-zinc-100 bg-slate-50 dark:bg-zinc-800 rounded-xl p-3 max-h-[60vh] overflow-auto">{entry.body}</pre>
            : <p className="text-xs text-slate-400 dark:text-zinc-500 italic">Meddelandet sparades inte för det här utskicket.</p>}
        </div>
      )}
    </Modal>
  )
}
