import { useState } from 'react'
import { Phone } from 'lucide-react'

interface Props {
  phone: string
  body: string
  /** Körs först när användaren bekräftat att SMS:et faktiskt skickades */
  onSent: () => void
  className: string
  showIcon?: boolean
}

// Öppnar SMS-appen och frågar sedan "Skickat?" — leverantören markeras inte
// klar förrän användaren bekräftat, så ett avbrutet SMS lämnar inte tavlan grön.
export default function SmsLink({ phone, body, onSent, className, showIcon = true }: Props) {
  const [asking, setAsking] = useState(false)

  if (asking) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <span className="text-slate-500 px-1">Skickat?</span>
        <button
          onClick={() => { setAsking(false); onSent() }}
          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
        >
          Ja
        </button>
        <button
          onClick={() => setAsking(false)}
          className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 font-medium hover:bg-slate-200 transition-colors"
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
    >
      {showIcon && <Phone size={11} />} SMS
    </a>
  )
}
