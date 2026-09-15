import { useState } from 'react'
import { Phone } from 'lucide-react'

interface Props {
  phone: string
  body: string
  /** Körs först när användaren bekräftat att SMS:et faktiskt skickades */
  onSent: () => void
  className: string
  showIcon?: boolean
  /** Knapptext, default "SMS" — t.ex. "SMS · Anna" när leverantören har flera nummer */
  label?: string
  title?: string
}

// Öppnar SMS-appen och frågar sedan "Skickat?" — leverantören markeras inte
// klar förrän användaren bekräftat, så ett avbrutet SMS lämnar inte tavlan grön.
export default function SmsLink({ phone, body, onSent, className, showIcon = true, label = 'SMS', title }: Props) {
  const [asking, setAsking] = useState(false)

  if (asking) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-slate-500 dark:text-zinc-400 px-1">Skickat?</span>
        <button
          onClick={() => { setAsking(false); onSent() }}
          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
        >
          Ja
        </button>
        <button
          onClick={() => setAsking(false)}
          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
        >
          Nej
        </button>
      </span>
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
