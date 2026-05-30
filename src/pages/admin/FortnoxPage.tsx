import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  ReceiptText, Plus, Trash2, Play, Building2, Pencil, Check, X,
  CheckCircle2, AlertCircle, MinusCircle, Info, Plug, Link2, RefreshCw, Ban, FileUp,
} from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import { useQoplaSales } from '../../hooks/useQoplaSales'
import {
  useFortnoxCompanies, useCreateFortnoxCompany, useRenameFortnoxCompany, useDeleteFortnoxCompany,
  useFortnoxShopMap, useUpsertShopMap, useFortnoxPostings, useRunFortnoxSync, useReconcileFortnox,
  useFortnoxConnections, startFortnoxConnect, useDinkassaMachines, useImportSie, useRunDinkassa,
  type FortnoxCompany, type FortnoxShopMap,
} from '../../hooks/useFortnox'

interface MappableShop { id: string; name: string; source: 'qopla' | 'dinkassa' }

export default function FortnoxPage() {
  const { data: shops = [], isLoading: shopsLoading } = useQoplaSales()
  const { data: dinMachines = [] } = useDinkassaMachines()
  const { data: companies = [] } = useFortnoxCompanies()
  const { data: maps = [] } = useFortnoxShopMap()
  const { data: postings = [] } = useFortnoxPostings()
  const { data: connections = {} } = useFortnoxConnections()

  // Unified mappable shop list across POS sources. dinkassa kassor come from the live
  // endpoint when available, plus any rows already seeded in the DB (e.g. by the
  // GitHub Action) so they're mappable even when the live login is unavailable.
  const dinLiveIds = new Set(dinMachines.map(m => m.id))
  const allShops: MappableShop[] = [
    ...shops.map(s => ({ id: s.shopId, name: s.restaurant, source: 'qopla' as const })),
    ...dinMachines.map(m => ({ id: m.id, name: `Chao – ${m.name}`, source: 'dinkassa' as const })),
    ...maps
      .filter(m => m.source === 'dinkassa' && !dinLiveIds.has(m.qopla_shop_id))
      .map(m => ({ id: m.qopla_shop_id, name: m.qopla_shop_name || m.qopla_shop_id, source: 'dinkassa' as const })),
  ]

  const createCompany = useCreateFortnoxCompany()
  const upsertMap = useUpsertShopMap()
  const runSync = useRunFortnoxSync()
  const reconcile = useReconcileFortnox()
  const importSie = useImportSie()
  const runDinkassa = useRunDinkassa()

  const [newCompany, setNewCompany] = useState('')
  const [importCompany, setImportCompany] = useState('')
  const [dinkassaFrom, setDinkassaFrom] = useState('')
  const [dinkassaTo, setDinkassaTo] = useState('')
  const [qoplaFrom, setQoplaFrom] = useState('')
  const [qoplaTo, setQoplaTo] = useState('')

  // Toast the result of an OAuth connect redirect, then clean the URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const r = p.get('fortnox')
    if (!r) return
    if (r === 'ok') toast.success('Bolag anslutet till Fortnox')
    else toast.error(`Anslutning misslyckades: ${p.get('msg') ?? 'okänt fel'}`)
    window.history.replaceState({}, '', '/admin/fortnox')
  }, [])

  const mapByShop = new Map(maps.map(m => [m.qopla_shop_id, m]))
  const nameByShop = new Map(allShops.map(s => [s.id, s.name]))

  const handleAddCompany = async () => {
    const name = newCompany.trim()
    if (!name) return
    try {
      await createCompany.mutateAsync(name)
      toast.success('Bolag tillagt')
      setNewCompany('')
    } catch { toast.error('Kunde inte lägga till bolag') }
  }

  const saveMap = (shop: MappableShop, patch: Partial<FortnoxShopMap>) => {
    const existing = mapByShop.get(shop.id)
    const row: FortnoxShopMap = {
      qopla_shop_id: shop.id,
      qopla_shop_name: shop.name,
      company_id: existing?.company_id ?? null,
      cost_center: existing?.cost_center ?? null,
      enabled: existing?.enabled ?? true,
      source: shop.source,
      ...patch,
    }
    upsertMap.mutate(row, {
      onSuccess: () => toast.success('Sparat'),
      onError: () => toast.error('Kunde inte spara'),
    })
  }

  const syncToast = (data: { note?: string; results: { status: string }[] }) => {
    if (data.note && !data.results.length) { toast(data.note); return }
    const ok = data.results.filter(r => r.status === 'ok').length
    const err = data.results.filter(r => r.status === 'error').length
    const skip = data.results.filter(r => r.status === 'skipped').length
    if (err) toast.error(`${ok} bokförda, ${skip} hoppade, ${err} fel`)
    else toast.success(`${ok} bokförda, ${skip} hoppade`)
  }

  const handleRun = () => {
    runSync.mutate({}, { onSuccess: syncToast, onError: (e) => toast.error((e as Error).message) })
  }

  const handleRunQopla = () => {
    if (qoplaTo && qoplaFrom && qoplaTo < qoplaFrom) { toast.error('Till-datum före Från-datum'); return }
    runSync.mutate({ from: qoplaFrom || undefined, to: qoplaTo || undefined }, {
      onSuccess: syncToast,
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const handleReconcile = () => {
    reconcile.mutate(undefined, {
      onSuccess: (data) => {
        if (!data.changed.length) toast.success('Synkad — inga ändringar')
        else toast(`${data.changed.length} markerade som borttagna i Fortnox`)
      },
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return
    if (!importCompany) { toast.error('Välj bolag först'); return }
    const sie = await file.text()
    importSie.mutate({ sie, companyId: importCompany, source: file.name }, {
      onSuccess: (d) => {
        const errs = d.results?.filter(r => r.status === 'error').length ?? 0
        const skip = d.skipped ?? 0
        if (d.posted) toast.success(`${d.posted} bokförda${skip ? `, ${skip} redan importerade` : ''}${errs ? `, ${errs} fel` : ''}`)
        else if (skip) toast(`Allt redan importerat (${skip} hoppade) — ingen dubbelbokföring`)
        else toast(d.message || 'Inget bokfört')
      },
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const handleRunDinkassa = () => {
    if (dinkassaTo && dinkassaFrom && dinkassaTo < dinkassaFrom) { toast.error('Till-datum före Från-datum'); return }
    runDinkassa.mutate({ from: dinkassaFrom || undefined, to: dinkassaTo || undefined }, {
      onSuccess: (d) => {
        const span = d.to && d.to !== d.from ? `${d.from}…${d.to}` : d.from
        toast.success(`dinkassa-körning startad (${span}) — resultat om ~1–2 min`)
      },
      onError: (e) => toast.error((e as Error).message),
    })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ReceiptText size={20} className="text-indigo-600" />
            Fortnox-bokföring
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Koppla Qopla-butiker till Fortnox-bolag. Körs automatiskt 23:00 — verifikat skapas i serie F.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={handleReconcile}
            disabled={reconcile.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 transition-colors"
            title="Kontrollera bokförda verifikat mot Fortnox och flagga borttagna"
          >
            {reconcile.isPending ? <Spinner size={16} /> : <RefreshCw size={16} />}
            Synka status
          </button>
          <button
            onClick={handleRun}
            disabled={runSync.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {runSync.isPending ? <Spinner size={16} className="border-white border-t-white/30" /> : <Play size={16} />}
            Kör nu
          </button>
        </div>
      </div>

      {/* Prerequisites note */}
      <div className="flex gap-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
        <Info size={15} className="shrink-0 mt-0.5 text-amber-500" />
        <span>
          Varje Fortnox-bolag måste auktorisera integrationen en gång (egen token), serie <b>F</b> måste finnas
          och vara öppen, och alla konton/kostnadsställen i SIE-datan måste finnas i bolagets kontoplan.
        </span>
      </div>

      {/* Bolag */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Building2 size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Fortnox-bolag</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <input
              value={newCompany}
              onChange={e => setNewCompany(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCompany()}
              placeholder="Nytt bolag (namn)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
            />
            <button
              onClick={handleAddCompany}
              disabled={!newCompany.trim() || createCompany.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <Plus size={16} /> Lägg till
            </button>
          </div>
          {companies.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Inga bolag ännu.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {companies.map(c => <CompanyRow key={c.id} company={c} connected={!!connections[c.id]} />)}
            </div>
          )}
        </div>
      </section>

      {/* Butik → Bolag */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <ReceiptText size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Butik → Bolag</h2>
        </div>
        <div className="p-5">
          {shopsLoading && allShops.length === 0 ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : allShops.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Inga butiker/kassor hämtade.</p>
          ) : (
            <div className="space-y-2">
              {allShops.map(shop => {
                const m = mapByShop.get(shop.id)
                const enabled = m?.enabled ?? true
                return (
                  <div key={shop.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="flex-1 min-w-[8rem] text-sm font-medium text-slate-700 truncate flex items-center gap-1.5">
                      {shop.name}
                      {shop.source === 'dinkassa' && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">dinkassa</span>
                      )}
                    </span>
                    <select
                      value={m?.company_id ?? ''}
                      onChange={e => saveMap(shop, { company_id: e.target.value || null })}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                    >
                      <option value="">— ej kopplad —</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <input
                      defaultValue={m?.cost_center ?? ''}
                      onBlur={e => {
                        const val = e.target.value.trim()
                        if (val !== (m?.cost_center ?? '')) saveMap(shop, { cost_center: val || null })
                      }}
                      placeholder="Kostnadsställe"
                      className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
                    />
                    <button
                      onClick={() => saveMap(shop, { enabled: !enabled })}
                      title={enabled ? 'Aktiv — klicka för att pausa' : 'Pausad — klicka för att aktivera'}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        enabled
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {enabled ? <Check size={13} /> : <X size={13} />}
                      {enabled ? 'Aktiv' : 'Pausad'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* Kör Qopla för datum/period */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Play size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Kör Qopla</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">
            Bokför Qopla-butikerna för valt datum eller period. Tomt = idag ("Kör nu" uppe).
            En verifikation per butik per dag. Redan bokförda dagar hoppas över.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Från
              <input
                type="date"
                value={qoplaFrom}
                onChange={e => setQoplaFrom(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </label>
            <label className="text-xs text-slate-500">
              Till <span className="text-slate-400">(valfritt)</span>
              <input
                type="date"
                value={qoplaTo}
                onChange={e => setQoplaTo(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </label>
            <button
              onClick={handleRunQopla}
              disabled={runSync.isPending || !qoplaFrom}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {runSync.isPending ? <Spinner size={14} className="border-white border-t-white/30" /> : <Play size={14} />}
              Kör Qopla
            </button>
          </div>
        </div>
      </section>

      {/* Kör dinkassa (trigga GitHub Action) */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <Play size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Kör dinkassa</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">
            Startar dinkassa-hämtningen (via GitHub Actions) och bokför mot kopplade bolag.
            Tomt = gårdagen. Ange Från för en dag, eller Från + Till för en period. En verifikation per kassa per dag.
            Redan bokförda dagar hoppas över. Resultat syns i Senaste körningar om ~1–2 min.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              Från
              <input
                type="date"
                value={dinkassaFrom}
                onChange={e => setDinkassaFrom(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </label>
            <label className="text-xs text-slate-500">
              Till <span className="text-slate-400">(valfritt)</span>
              <input
                type="date"
                value={dinkassaTo}
                onChange={e => setDinkassaTo(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </label>
            <button
              onClick={handleRunDinkassa}
              disabled={runDinkassa.isPending}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {runDinkassa.isPending ? <Spinner size={14} className="border-white border-t-white/30" /> : <Play size={14} />}
              Kör dinkassa
            </button>
          </div>
        </div>
      </section>

      {/* Importera SIE-fil (dinkassa m.fl.) */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <FileUp size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Importera SIE-fil</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500">
            För kassasystem utan API (t.ex. dinkassa): ladda ner <code className="text-slate-700">.se</code>-filen
            och bokför den mot valt bolag. Samma verifikationer hoppas över automatiskt — ingen dubbelbokföring.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={importCompany}
              onChange={e => setImportCompany(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
            >
              <option value="">— välj bolag —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              importCompany && !importSie.isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}>
              {importSie.isPending ? <Spinner size={14} className="border-white border-t-white/30" /> : <FileUp size={14} />}
              Välj .se-fil & bokför
              <input
                type="file"
                accept=".se,.si,.sie,.txt"
                className="hidden"
                disabled={!importCompany || importSie.isPending}
                onChange={e => { handleImportFile(e.target.files?.[0]); e.target.value = '' }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* Senaste körning */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <ReceiptText size={16} className="text-slate-400" />
          <h2 className="font-semibold text-slate-900 text-sm">Senaste körningar</h2>
        </div>
        <div className="p-5">
          {postings.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Inga körningar ännu.</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {postings.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                  <StatusBadge status={p.status} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-700 truncate">
                      {nameByShop.get(p.qopla_shop_id) ?? p.qopla_shop_id}
                      <span className="text-slate-400 font-normal"> · {p.business_date}</span>
                    </div>
                    {p.message && <div className="text-xs text-slate-400 truncate">{p.message}</div>}
                  </div>
                  {p.voucher_number && (
                    <span className={`shrink-0 text-xs font-mono ${p.status === 'deleted' ? 'text-red-400 line-through' : 'text-slate-500'}`}>
                      {p.voucher_number}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok')
    return <span className="shrink-0 inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 size={15} /></span>
  if (status === 'error')
    return <span className="shrink-0 inline-flex items-center gap-1 text-red-500"><AlertCircle size={15} /></span>
  if (status === 'deleted')
    return <span className="shrink-0 inline-flex items-center gap-1 text-red-500" title="Borttagen i Fortnox"><Ban size={15} /></span>
  return <span className="shrink-0 inline-flex items-center gap-1 text-slate-300"><MinusCircle size={15} /></span>
}

function CompanyRow({ company, connected }: { company: FortnoxCompany; connected: boolean }) {
  const rename = useRenameFortnoxCompany()
  const del = useDeleteFortnoxCompany()
  const [editing, setEditing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [name, setName] = useState(company.name)

  const handleConnect = async () => {
    setConnecting(true)
    try {
      await startFortnoxConnect(company.id) // full-page redirect to Fortnox
    } catch (e) {
      toast.error((e as Error).message)
      setConnecting(false)
    }
  }

  const save = async () => {
    const next = name.trim()
    if (!next || next === company.name) { setEditing(false); setName(company.name); return }
    try {
      await rename.mutateAsync({ id: company.id, name: next })
      toast.success('Sparat')
      setEditing(false)
    } catch { toast.error('Kunde inte spara') }
  }

  const handleDelete = async () => {
    if (!confirm(`Ta bort bolaget "${company.name}"? Mappningar nollställs.`)) return
    try {
      await del.mutateAsync(company.id)
      toast.success('Bolag borttaget')
    } catch { toast.error('Kunde inte ta bort') }
  }

  return (
    <div className="flex items-center gap-2 py-2">
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setName(company.name) } }}
          onBlur={save}
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-indigo-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
      ) : (
        <span className="flex-1 text-sm text-slate-700">{company.name}</span>
      )}
      {connected ? (
        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium">
          <Link2 size={13} /> Ansluten
        </span>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors"
          title="Anslut bolaget till Fortnox"
        >
          {connecting ? <Spinner size={12} /> : <Plug size={13} />} Anslut
        </button>
      )}
      <button
        onClick={() => setEditing(true)}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        title="Byt namn"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={handleDelete}
        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        title="Ta bort"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
