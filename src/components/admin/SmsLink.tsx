import { useEffect, useRef, useState } from 'react'
import { Loader2, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import { logSend, sendLogStatus, settlePendingSms, type SendLogInput } from '../../lib/sendLog'
import { smsShortcutUrl } from '../../lib/smsShortcut'
import { getSmsMode, macHelperSend } from '../../lib/smsMode'

interface Props {
  phone: string
  body: string
  /** Loggraden för utskicket (allt utom texten) — skrivs av SmsLink själv */
  log: Omit<SendLogInput, 'body' | 'id' | 'pending' | 'error'>
  /** Körs först när SMS:et bevisligen skickats (Mac-hjälparen/genvägen bekräftat eller användaren svarat "Ja") */
  onSent: () => void
  className: string
  showIcon?: boolean
  /** Knapptext, default "SMS" — t.ex. "SMS · Anna" när leverantören har flera nummer */
  label?: string
  title?: string
}

const BTN_YES = 'px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors'
const BTN_NO = 'px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors'

// Tre lägen, valda per enhet i Settings (smsMode.ts):
// - Mac-hjälpare: POST till hjälparen på 127.0.0.1 som skickar via AppleScript.
//   Inget öppnas; svaret säger direkt om det gick, och loggas som ett mail.
// - Genväg: kör genvägen "wOrder SMS" som skickar
//   SMS:et och bekräftar via RPC:n sms_confirm. Vi pollar loggraden och markerar
//   leverantören klar när den blivit 'sent'.
// - Annars: öppnar SMS-appen och frågar "Skickat?". Leverantören markeras inte
//   klar förrän användaren bekräftat, så ett avbrutet SMS lämnar inte tavlan grön.
export default function SmsLink({ phone, body, log, onSent, className, showIcon = true, label = 'SMS', title }: Props) {
  const [asking, setAsking] = useState(false)
  const [waitingId, setWaitingId] = useState<string | null>(null)
  const [sendingMac, setSendingMac] = useState(false)

  // Senaste callback/namn utan att starta om pollningen vid varje render
  const latest = useRef({ onSent, vendorName: log.vendorName })
  latest.current = { onSent, vendorName: log.vendorName }

  useEffect(() => {
    if (!waitingId) return
    let stopped = false
    let inFlight = false
    const check = async () => {
      if (stopped || inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      const status = await sendLogStatus(waitingId)
      inFlight = false
      if (stopped || status !== 'sent') return
      stopped = true
      setWaitingId(null)
      toast.success(`SMS skickat till ${latest.current.vendorName}`)
      latest.current.onSent()
    }
    // Kolla direkt när appen syns igen efter genvägen, och sedan varannan sekund
    const timer = setInterval(check, 2000)
    document.addEventListener('visibilitychange', check)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [waitingId])

  const startShortcut = () => {
    const id = crypto.randomUUID()
    // Raden skrivs parallellt — genvägen hinner inte bekräfta innan insert är klar
    void logSend({ ...log, body, id, pending: true })
    setWaitingId(id)
    window.location.href = smsShortcutUrl({ id, phone, body })
  }

  const sendViaMac = async () => {
    setSendingMac(true)
    try {
      await macHelperSend(phone, body)
      await logSend({ ...log, body })
      toast.success(`SMS skickat till ${log.vendorName}`)
      onSent()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Misslyckades'
      toast.error(`${log.vendorName}: ${message}`)
      // Som för mail: misslyckade försök syns med rött kryss i loggen
      void logSend({ ...log, body, error: message })
    } finally {
      setSendingMac(false)
    }
  }

  // "Klar" när genvägen skickat men bekräftelsen inte nådde fram (t.ex. utan nät)
  const confirmManually = async (id: string) => {
    setWaitingId(null)
    const status = await sendLogStatus(id)
    if (status === 'pending') await settlePendingSms(id, true)
    else if (status === null) await logSend({ ...log, body })
    onSent()
  }

  const cancel = (id: string) => {
    setWaitingId(null)
    void settlePendingSms(id, false)
  }

  if (waitingId) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="flex items-center gap-1 text-slate-500 dark:text-zinc-400 px-1">
          <Loader2 size={11} className="animate-spin" /> Väntar på SMS…
        </span>
        <button onClick={() => { void confirmManually(waitingId) }} className={BTN_YES} title="SMS:et gick iväg — markera klar">
          Klar
        </button>
        <button onClick={() => cancel(waitingId)} className={BTN_NO} title="SMS:et skickades inte">
          Avbryt
        </button>
      </span>
    )
  }

  if (asking) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-slate-500 dark:text-zinc-400 px-1">Skickat?</span>
        <button
          onClick={async () => { setAsking(false); await logSend({ ...log, body }); onSent() }}
          className={BTN_YES}
        >
          Ja
        </button>
        <button onClick={() => setAsking(false)} className={BTN_NO}>
          Nej
        </button>
      </span>
    )
  }

  const mode = getSmsMode()

  if (mode === 'mac') {
    return (
      <button onClick={() => { void sendViaMac() }} disabled={sendingMac} className={`${className} disabled:opacity-50`} title={title}>
        {sendingMac ? <Loader2 size={11} className="animate-spin inline" /> : showIcon && <Phone size={11} />} {label}
      </button>
    )
  }

  if (mode === 'shortcut') {
    return (
      <button onClick={startShortcut} className={className} title={title}>
        {showIcon && <Phone size={11} />} {label}
      </button>
    )
  }

  return (
    <a
      href={`sms:${phone}?body=${encodeURIComponent(body)}`}
      onClick={() => setAsking(true)}
      className={className}
      title={title}
    >
      {showIcon && <Phone size={11} />} {label}
    </a>
  )
}
