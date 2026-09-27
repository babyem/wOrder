import { createClient } from '@supabase/supabase-js'

// Schema-appens databas (Supabase-projektet "PersonalKollen", github babyem/schema).
// Egen klient: bara läsning med anon-nyckeln, ingen inloggning — och en egen
// storageKey så den inte krockar med wOrders auth-session i localStorage.
const url = import.meta.env.VITE_SCHEMA_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SCHEMA_SUPABASE_ANON_KEY as string | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const schemaSupabase = url && key
  ? createClient<any>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'schema-readonly' },
    })
  : null
