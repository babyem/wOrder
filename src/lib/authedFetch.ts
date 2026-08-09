import { supabase } from './supabase'

// fetch mot våra egna /api-endpoints som kräver inloggad admin.
// Sessionens JWT skickas som Bearer — utan den svarar servern 401.
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Ingen inloggad session')
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  })
}
