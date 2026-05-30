import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface FortnoxCompany {
  id: string
  name: string
  org_no?: string | null
  created_at?: string
}

export interface FortnoxShopMap {
  qopla_shop_id: string
  qopla_shop_name?: string | null
  company_id: string | null
  cost_center?: string | null
  enabled: boolean
  source?: string
}

export interface DinkassaMachine { id: string; name: string }

export interface FortnoxPosting {
  id: string
  qopla_shop_id: string
  business_date: string
  company_id: string | null
  voucher_series: string | null
  voucher_number: string | null
  status: 'ok' | 'error' | 'skipped' | 'deleted'
  message: string | null
  created_at: string
}

export interface SyncResult {
  shop: string
  shopId: string
  status: 'ok' | 'error' | 'skipped'
  voucherNumbers?: string[]
  warnings?: string[]
  message?: string
}

// ---- Companies (bolag) ----
export function useFortnoxCompanies() {
  return useQuery({
    queryKey: ['fortnox-companies'],
    queryFn: async (): Promise<FortnoxCompany[]> => {
      const { data, error } = await supabase.from('fortnox_companies').select('*').order('name')
      if (error) return []
      return data
    },
  })
}

export function useCreateFortnoxCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from('fortnox_companies').insert({ name }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-companies'] }),
  })
}

export function useRenameFortnoxCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('fortnox_companies').update({ name }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-companies'] }),
  })
}

export function useDeleteFortnoxCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('fortnox_companies').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fortnox-companies'] })
      qc.invalidateQueries({ queryKey: ['fortnox-shop-map'] })
    },
  })
}

// ---- Shop → company mapping ----
export function useFortnoxShopMap() {
  return useQuery({
    queryKey: ['fortnox-shop-map'],
    queryFn: async (): Promise<FortnoxShopMap[]> => {
      const { data, error } = await supabase.from('fortnox_shop_map').select('*')
      if (error) return []
      return data
    },
  })
}

export function useUpsertShopMap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: FortnoxShopMap) => {
      const { error } = await supabase
        .from('fortnox_shop_map')
        .upsert(row, { onConflict: 'qopla_shop_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-shop-map'] }),
  })
}

// ---- Posting log ----
export function useFortnoxPostings(limit = 50) {
  return useQuery({
    queryKey: ['fortnox-postings'],
    queryFn: async (): Promise<FortnoxPosting[]> => {
      const { data, error } = await supabase
        .from('fortnox_postings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) return []
      return data
    },
  })
}

// ---- dinkassa kassor (for the mapping list) ----
export function useDinkassaMachines() {
  return useQuery({
    queryKey: ['dinkassa-machines'],
    queryFn: async (): Promise<DinkassaMachine[]> => {
      const res = await fetch('/api/dinkassa?action=machines')
      if (!res.ok) return []
      const json = await res.json()
      return json.machines ?? []
    },
    staleTime: 10 * 60 * 1000,
  })
}

// ---- OAuth connection status (which bolag have a token) ----
export function useFortnoxConnections() {
  return useQuery({
    queryKey: ['fortnox-connections'],
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return {}
      const res = await fetch('/api/fortnox-oauth?status=1', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return {}
      const json = await res.json()
      return json.connected ?? {}
    },
  })
}

// Kick off the OAuth consent flow for a bolag (full-page redirect to Fortnox).
export async function startFortnoxConnect(companyId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Ingen inloggad session')
  const res = await fetch(`/api/fortnox-oauth?init=1&company_id=${encodeURIComponent(companyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Kunde inte starta Fortnox-anslutning')
  window.location.href = json.url
}

// ---- Manual trigger ("Kör nu") ----
export function useRunFortnoxSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ ranAt: string; businessDate: string; results: SyncResult[]; note?: string }> => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Ingen inloggad session')
      const res = await fetch('/api/fortnox-sync?force=1', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Synk misslyckades')
      return json
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-postings'] }),
  })
}

// ---- Trigger the dinkassa GitHub Action (scrape + book) for a date ----
export function useRunDinkassa() {
  return useMutation({
    mutationFn: async (range: { from?: string; to?: string } = {}): Promise<{ triggered: boolean; from: string; to: string }> => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Ingen inloggad session')
      const res = await fetch('/api/dinkassa-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ from: range.from || undefined, to: range.to || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Kunde inte starta körning')
      return json
    },
  })
}

// ---- Manual SIE-file import (dinkassa etc.) ----
export interface ImportResult {
  posted: number
  skipped?: number
  results: { date: string; voucher?: string; status: string; message?: string }[]
  warnings: string[]
  message?: string
}

export function useImportSie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ sie, companyId, source }: { sie: string; companyId: string; source?: string }): Promise<ImportResult> => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Ingen inloggad session')
      const res = await fetch('/api/fortnox-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sie, companyId, source }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Import misslyckades')
      return json
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-postings'] }),
  })
}

// ---- Reconcile ("Synka status"): flag vouchers deleted in Fortnox ----
export function useReconcileFortnox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ reconciledAt: string; changed: { shop: string; voucher: string; businessDate: string }[] }> => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Ingen inloggad session')
      const res = await fetch('/api/fortnox-sync?action=reconcile', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Synk misslyckades')
      return json
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fortnox-postings'] }),
  })
}
