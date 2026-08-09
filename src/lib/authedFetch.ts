import { supabase } from './supabase'

// fetch mot våra egna /api-endpoints som kräver inloggad admin.
// Sessionens JWT skickas som Bearer — utan den svarar servern 401.
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Ingen inloggad session')
  return fetch(url, {
    // no-store: svaren har private-cache i upp till 10 min, och utan detta skulle en
    // manuell refresh kunna serveras ur webbläsarcachen istället för att hämta nytt.
    // React Querys staleTime står för den vanliga dedupliceringen.
    cache: 'no-store',
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  })
}
