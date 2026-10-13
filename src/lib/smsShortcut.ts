// SMS via Genvägar: i stället för att öppna Meddelanden startar SMS-knappen
// genvägen "wOrder SMS", som skickar SMS:et automatiskt och sedan anropar
// RPC:n sms_confirm (migration 040) så att appen vet att det faktiskt gick
// iväg. Inställningen är per enhet (localStorage) eftersom genvägen måste vara
// installerad på enheten.

export const SMS_SHORTCUT_NAME = 'wOrder SMS'

const STORAGE_KEY = 'sms-shortcut'

export function smsShortcutEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export function setSmsShortcutEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}

/**
 * shortcuts://-länk som kör genvägen med ett JSON-objekt som indata.
 * Genvägen läser `phone` och `body`, skickar SMS:et och POST:ar `{ id }` till `confirm`.
 */
export function smsShortcutUrl({ id, phone, body }: { id: string; phone: string; body: string }): string {
  // Direkt mot Supabase (Vercel Hobby tillåter inte fler funktioner). Anon-nyckeln
  // är publik ändå; i query-strängen slipper genvägen sätta egna headers.
  const confirm = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/sms_confirm?apikey=${import.meta.env.VITE_SUPABASE_ANON_KEY}`
  const input = JSON.stringify({ id, phone, body, confirm })
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SMS_SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(input)}`
}
