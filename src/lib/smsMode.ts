// Hur SMS-knappen skickar på den här enheten (localStorage, valt i Settings):
// - 'messages': öppnar Meddelanden och frågar "Skickat?" (fungerar överallt)
// - 'shortcut': kör genvägen "wOrder SMS" (iPhone/Mac, se smsShortcut.ts)
// - 'mac':      anropar Mac-hjälparen på 127.0.0.1 som skickar via AppleScript,
//               helt i bakgrunden (scripts/mac-sms-helper)

export type SmsMode = 'messages' | 'shortcut' | 'mac'

const STORAGE_KEY = 'sms-mode'
/** Före 'sms-mode' fanns bara på/av för genvägen */
const LEGACY_SHORTCUT_KEY = 'sms-shortcut'

export function getSmsMode(): SmsMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'shortcut' || v === 'mac') return v
    if (v === null && localStorage.getItem(LEGACY_SHORTCUT_KEY) === '1') return 'shortcut'
  } catch { /* ignore */ }
  return 'messages'
}

export function setSmsMode(mode: SmsMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
    localStorage.removeItem(LEGACY_SHORTCUT_KEY)
  } catch { /* ignore */ }
}

const MAC_HELPER_URL = 'http://127.0.0.1:47821'

// Chrome (Local Network Access) vill veta att anropet går till den egna datorn
const LOOPBACK = { targetAddressSpace: 'loopback' } as RequestInit

/** true om Mac-hjälparen svarar på den här datorn */
export async function macHelperHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${MAC_HELPER_URL}/health`, { ...LOOPBACK, signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/** Skickar SMS:et via Mac-hjälparen. Kastar med ett läsbart fel om det inte gick. */
export async function macHelperSend(phone: string, body: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${MAC_HELPER_URL}/send`, {
      ...LOOPBACK,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, body }),
      signal: AbortSignal.timeout(40_000),
    })
  } catch {
    throw new Error('Mac-hjälparen svarar inte — körs den på den här datorn?')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(data?.error ?? `Mac-hjälparen svarade ${res.status}`)
  }
}
