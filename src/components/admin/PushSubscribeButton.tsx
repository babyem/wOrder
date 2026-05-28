import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { usePushSubscription } from '../../hooks/usePushSubscription'

export default function PushSubscribeButton() {
  const { status, subscribe, unsubscribe } = usePushSubscription()

  if (status === 'unsupported') return null

  if (status === 'subscribed') {
    return (
      <button
        onClick={unsubscribe}
        title="Push-notiser aktiva — klicka för att avsluta"
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-all w-full"
      >
        <BellRing size={18} />
        Notiser på
      </button>
    )
  }

  if (status === 'denied') {
    return (
      <button
        disabled
        title="Notiser blockerade i webbläsaren"
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 w-full cursor-not-allowed"
      >
        <BellOff size={18} />
        Notiser blockerade
      </button>
    )
  }

  return (
    <button
      onClick={subscribe}
      disabled={status === 'loading'}
      title="Aktivera push-notiser för nya beställningar"
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all w-full disabled:opacity-50"
    >
      {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
      Aktivera notiser
    </button>
  )
}
