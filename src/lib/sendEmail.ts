import { supabase } from './supabase'

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { to, subject, text },
  })
  if (error) throw new Error(error.message ?? JSON.stringify(error))
  if (data?.error) {
    const msg = data.error?.message ?? data.error?.name ?? JSON.stringify(data.error)
    throw new Error(msg)
  }
}
