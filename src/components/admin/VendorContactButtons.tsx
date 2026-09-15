import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import toast from 'react-hot-toast'
import SmsLink from './SmsLink'
import { sendEmail } from '../../lib/sendEmail'
import { contactLabel, contactShortName, type VendorContact } from '../../lib/vendorContacts'

interface Props {
  vendorName: string
  contacts: VendorContact[]
  body: string
  subject: string
  bccSubject?: string
  /** Körs efter lyckat mail eller när användaren bekräftat att SMS:et skickades */
  onSent: () => void | Promise<void>
  /** 'card' = textknappar som fyller raden (OrderCard), 'modal' = ikonknappar (batch/express) */
  variant: 'card' | 'modal'
  /** Text när leverantören saknar kontaktvägar; utelämna för att inte visa något */
  emptyText?: string
}

const STYLES = {
  card: {
    email: 'flex-1 py-1.5 px-2 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors text-center whitespace-nowrap',
    sms: 'flex-1 py-1.5 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors text-center whitespace-nowrap',
  },
  modal: {
    email: 'flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors',
    sms: 'flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors',
  },
}

// En knapp per kontaktväg. Smeknamnet syns i knappen och i toasten så man vet
// vilken adress som faktiskt fick meddelandet.
export default function VendorContactButtons({ vendorName, contacts, body, subject, bccSubject, onSent, variant, emptyText }: Props) {
  const [sending, setSending] = useState<string | null>(null)
  const styles = STYLES[variant]

  if (contacts.length === 0) {
    return emptyText
      ? <span className="text-[10px] text-slate-300 dark:text-zinc-600 italic px-2 py-1">{emptyText}</span>
      : null
  }

  const send = async (c: VendorContact) => {
    setSending(c.id)
    try {
      await sendEmail(c.value, subject, body, bccSubject)
      toast.success(`Email skickat till ${vendorName} (${contactShortName(c)})`)
      await onSent()
    } catch (err) {
      toast.error(`${vendorName}: ${err instanceof Error ? err.message : 'Misslyckades'}`)
    } finally {
      setSending(null)
    }
  }

  return (
    <>
      {contacts.map(c => c.type === 'email' ? (
        <button
          key={c.id}
          disabled={sending !== null}
          onClick={() => send(c)}
          title={c.value}
          className={styles.email}
        >
          {sending === c.id
            ? <Loader2 size={11} className={variant === 'card' ? 'animate-spin inline' : 'animate-spin'} />
            : variant === 'modal' ? <Mail size={11} /> : null}
          {sending === c.id && variant === 'card' ? null : contactLabel(c, contacts)}
        </button>
      ) : (
        <SmsLink
          key={c.id}
          phone={c.value}
          body={body}
          label={contactLabel(c, contacts)}
          title={c.value}
          showIcon={variant === 'modal'}
          onSent={onSent}
          className={styles.sms}
        />
      ))}
    </>
  )
}
