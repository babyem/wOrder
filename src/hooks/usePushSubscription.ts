import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray.buffer as ArrayBuffer
}

export type PushStatus = 'idle' | 'subscribed' | 'denied' | 'unsupported' | 'loading'

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>('idle')

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('denied')
      return
    }
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then(reg =>
        reg.pushManager.getSubscription().then(sub => {
          if (sub) setStatus('subscribed')
        })
      )
    }
  }, [])

  const subscribe = async () => {
    if (!('serviceWorker' in navigator)) {
      alert('Din webbläsare stödjer inte service workers som krävs för push-notiser.')
      return
    }
    if (!VAPID_PUBLIC_KEY) {
      console.error('VITE_VAPID_PUBLIC_KEY is not set')
      alert('Push-notiser är inte konfigurerade — VAPID-nyckel saknas i miljövariabler.\n\nLägg till VITE_VAPID_PUBLIC_KEY i Vercel-inställningarna och gör om deploy.')
      return
    }
    setStatus('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setStatus('denied'); return }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      const { error } = await supabase.from('push_subscriptions').upsert(
        { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: 'endpoint' }
      )
      if (error) {
        console.error('Supabase upsert error:', error)
        alert(`Kunde inte spara prenumerationen: ${error.message}\n\nKontrollera att tabellen push_subscriptions finns i Supabase.`)
        setStatus('idle')
        return
      }
      setStatus('subscribed')
    } catch (err) {
      console.error('Push subscription error:', err)
      alert(`Kunde inte aktivera push-notiser:\n${err instanceof Error ? err.message : String(err)}`)
      setStatus('idle')
    }
  }

  const unsubscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setStatus('idle')
    } catch {
      setStatus('idle')
    }
  }

  return { status, subscribe, unsubscribe }
}
