import { Bell, BellOff, BellRing, Loader2 } from 'lucide-react'
import { usePushSubscription } from '../../hooks/usePushSubscription'

interface Props { compact?: boolean }

function handleUnsupported() {
  alert('För att få push-notiser på iPhone:\n\n1. Tryck på dela-knappen (□↑) i Safari\n2. Välj "Lägg till på hemskärmen"\n3. Öppna appen via hemskärmsikonen\n4. Tryck på klockknappen igen')
}

export default function PushSubscribeButton({ compact = false }: Props) {
  const { status, subscribe, unsubscribe } = usePushSubscription()

  if (compact) {
    if (status === 'subscribed') {
      return (
        <button onClick={unsubscribe} title="Push-notiser aktiva — tryck för att avsluta"
          className="p-2 rounded-xl text-emerald-500 hover:bg-emerald-50 transition-colors">
          <BellRing size={18} />
        </button>
      )
    }
    if (status === 'denied') {
      return (
        <button disabled title="Notiser blockerade"
          className="p-2 rounded-xl text-slate-300 cursor-not-allowed">
          <BellOff size={18} />
        </button>
      )
    }
    return (
      <button
        onClick={status === 'unsupported' ? handleUnsupported : subscribe}
        disabled={status === 'loading'}
        title="Aktivera push-notiser"
        className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50">
        {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
      </button>
    )
  }

  if (status === 'subscribed') {
    return (
      <button onClick={unsubscribe}
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-emerald-600 hover:bg-emerald-50 transition-all w-full">
        <BellRing size={18} /> Notiser på
      </button>
    )
  }

  if (status === 'denied') {
    return (
      <button disabled
        className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-300 w-full cursor-not-allowed">
        <BellOff size={18} /> Notiser blockerade
      </button>
    )
  }

  return (
    <button
      onClick={status === 'unsupported' ? handleUnsupported : subscribe}
      disabled={status === 'loading'}
      className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-all w-full disabled:opacity-50">
      {status === 'loading' ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}
      Aktivera notiser
    </button>
  )
}
