import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  ReceiptText, Plus, Trash2, Play, Building2, Pencil, Check, X,
  CheckCircle2, AlertCircle, MinusCircle, Info, Plug, Link2, RefreshCw, Ban, FileUp,
} from 'lucide-react'
import Spinner from '../../components/ui/Spinner'
import Modal from '../../components/ui/Modal'
import { useQoplaSales } from '../../hooks/useQoplaSales'
import {
  useFortnoxCompanies, useCreateFortnoxCompany, useRenameFortnoxCompany, useDeleteFortnoxCompany,
  useFortnoxShopMap, useUpsertShopMap, useFortnoxPostings, useRunFortnoxSync, useReconcileFortnox,
  useFortnoxConnections, startFortnoxConnect, useDinkassaMachines, useImportSie, useRunDinkassa, useRunAncon,
  type FortnoxCompany, type FortnoxShopMap, type FortnoxPosting,
} from '../../hooks/useFortnox'

interface MappableShop { id: string; name: string; source: 'qopla' | 'dinkassa' | 'ancon' }
interface RunRow { shop?: string; date?: string; status: string; voucherNumbers?: string[]; voucher?: string; message?: string }

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
    ...maps
      .filter(m => m.source === 'ancon')
      .map(m => ({ id: m.qopla_shop_id, name: m.qopla_shop_name || m.qopla_shop_id, source: 'ancon' as const })),
  ]

  const createCompany = useCreateFortnoxCompany()
  const upsertMap = useUpsertShopMap()
  const runSync = useRunFortnoxSync()
  const reconcile = useReconcileFortnox()
  const importSie = useImportSie()
  const runDinkassa = useRunDinkassa()
  const runAncon = useRunAncon()

  const [newCompany, setNewCompany] = useState('')
  const [importCompany, setImportCompany] = useState('')
  const [dinkassaFrom, setDinkassaFrom] = useState('')
  const [dinkassaTo, setDinkassaTo] = useState('')
  const [qoplaFrom, setQoplaFrom] = useState('')
  const [qoplaTo, setQoplaTo] = useState('')
  const [anconFrom, setAnconFrom] = useState('')
  const [anconTo, setAnconTo] = useState('')
  const [qoplaExcluded, setQoplaExcluded] = useState<Set<string>>(new Set()) // deselected shops
  const [runModal, setRunModal] = useState<{ title: string; results: RunRow[] } | null>(null)
  const [postingShop, setPostingShop] = useState<string>('') // '' = alla butiker
  const [postingVisible, setPostingVisible] = useState(25)

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
  const companyNameById = new Map(companies.map(c => [c.id, c.name]))
  // A posting's bolag: prefer the value recorded at booking, else the shop's current mapping.
  const companyOfPosting = (p: FortnoxPosting) => p.company_id ?? mapByShop.get(p.qopla_shop_id)?.company_id ?? null
  // Distinct shops that actually appear in the loaded postings, for the filter dropdown.
  const postingShops = Array.from(new Set(postings.map(p => p.qopla_shop_id)))
    .map(id => ({ id, name: nameByShop.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  const filteredPostings = postingShop
    ? postings.filter(p => p.qopla_shop_id === postingShop)
    : postings
  const visiblePostings = filteredPostings.slice(0, postingVisible)

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

  const showRun = (title: string) => (data: { note?: string; results?: RunRow[] }) => {
    if (data.note && !(data.results || []).length) { toast(data.note); return }
    const results = [...(data.results || [])].sort((a, b) =>
      (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : (a.shop || '').localeCompare(b.shop || ''))
    setRunModal({ title, results })
  }

  const handleRun = () => {
    runSync.mutate({}, { onSuccess: showRun('Qopla — igår + ikapp'), onError: (e) => toast.error((e as Error).message) })
  }

  const toggleQoplaShop = (id: string) => setQoplaExcluded(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const handleRunQopla = () => {
    const selected = shops.filter(s => !qoplaExcluded.has(s.shopId)).map(s => s.shopId)
    if (!selected.length) { toast.error('Välj minst en butik'); return }
    if (qoplaTo && qoplaFrom && qoplaTo < qoplaFrom) { toast.error('Till-datum före Från-datum'); return }
    runSync.mutate({ from: qoplaFrom || undefined, to: qoplaTo || undefined, shops: selected }, {
      onSuccess: showRun(`Qopla ${qoplaFrom || 'idag'}${qoplaTo && qoplaTo !== qoplaFrom ? `…${qoplaTo}` : ''}`),
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

  const handleRunAncon = () => {
    if (anconTo && anconFrom && anconTo < anconFrom) { toast.error('Till-datum före Från-datum'); return }
    runAncon.mutate({ from: anconFrom || undefined, to: anconTo || undefined }, {
      onSuccess: showRun('Woso Emporia (ancon)'),
      onError: (e) => toast.error((e as Error).message),
    })
  }

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return
    if (!importCompany) { toast.error('Välj bolag först'); return }
    const sie = await file.text()
    importSie.mutate({ sie, companyId: importCompany, source: file.name }, {
      onSuccess: (d) => {
        if (!d.results?.length) { toast(d.message || 'Inget bokfört'); return }
        showRun(`SIE-import (${file.name})`)(d)
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-zinc-100 flex items-center gap-2">
            <ReceiptText size={20} className="text-indigo-600 dark:text-indigo-400" />
            Fortnox-bokföring
          </h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-0.5">
            Koppla Qopla-butiker till Fortnox-bolag. Körs automatiskt varje morgon (bokför gårdagen och tar igen missade dagar) — verifikat skapas i serie F.
          </p>
        </div>
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          <button
            onClick={handleReconcile}
            disabled={reconcile.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-700 dark:text-zinc-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
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
      <div className="flex gap-2.5 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950 border border-amber-100 dark:border-amber-900 rounded-xl px-4 py-3">
        <Info size={15} className="shrink-0 mt-0.5 text-amber-500" />
        <span>
          Varje Fortnox-bolag måste auktorisera integrationen en gång (egen token), serie <b>F</b> måste finnas
          och vara öppen, och alla konton/kostnadsställen i SIE-datan måste finnas i bolagets kontoplan.
        </span>
      </div>

      {/* Bolag */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <Building2 size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Fortnox-bolag</h2>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2">
            <input
              value={newCompany}
              onChange={e => setNewCompany(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddCompany()}
              placeholder="Nytt bolag (namn)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
            />
            <button
              onClick={handleAddCompany}
              disabled={!newCompany.trim() || createCompany.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 dark:bg-zinc-800 text-white text-sm font-medium hover:bg-slate-800 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
            >
              <Plus size={16} /> Lägg till
            </button>
          </div>
          {companies.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-zinc-500 py-2">Inga bolag ännu.</p>
          ) : (
            <div className="divide-y divide-slate-50 dark:divide-zinc-800">
              {companies.map(c => <CompanyRow key={c.id} company={c} connected={!!connections[c.id]} />)}
            </div>
          )}
        </div>
      </section>

      {/* Butik → Bolag */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <ReceiptText size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Butik → Bolag</h2>
        </div>
        <div className="p-5">
          {shopsLoading && allShops.length === 0 ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : allShops.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-zinc-500 py-2">Inga butiker/kassor hämtade.</p>
          ) : (
            <div className="space-y-2">
              {allShops.map(shop => {
                const m = mapByShop.get(shop.id)
                const enabled = m?.enabled ?? true
                return (
                  <div key={shop.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="flex-1 min-w-[8rem] text-sm font-medium text-slate-700 dark:text-zinc-200 truncate flex items-center gap-1.5">
                      {shop.name}
                      {shop.source !== 'qopla' && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded">{shop.source}</span>
                      )}
                    </span>
                    <select
                      value={m?.company_id ?? ''}
                      onChange={e => saveMap(shop, { company_id: e.target.value || null })}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
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
                      className="w-32 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
                    />
                    <button
                      onClick={() => saveMap(shop, { enabled: !enabled })}
                      title={enabled ? 'Aktiv — klicka för att pausa' : 'Pausad — klicka för att aktivera'}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        enabled
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900'
                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 hover:bg-slate-200 dark:hover:bg-zinc-700'
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
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <Play size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Kör Qopla</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Bokför valda Qopla-butiker för valt datum eller period (olika bolag kan köras separat).
            Tomt datum = idag. En verifikation per butik per dag. Redan bokförda dagar hoppas över.
          </p>
          {shops.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                  Butiker ({shops.filter(s => !qoplaExcluded.has(s.shopId)).length}/{shops.length})
                </span>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setQoplaExcluded(new Set())} className="text-indigo-600 dark:text-indigo-400 hover:underline">Alla</button>
                  <button onClick={() => setQoplaExcluded(new Set(shops.map(s => s.shopId)))} className="text-slate-400 dark:text-zinc-500 hover:underline">Inga</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-40 overflow-auto pr-1">
                {shops.map(s => (
                  <label key={s.shopId} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-zinc-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!qoplaExcluded.has(s.shopId)}
                      onChange={() => toggleQoplaShop(s.shopId)}
                      className="rounded border-slate-300 dark:border-zinc-700"
                    />
                    <span className="truncate">{s.restaurant}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Från
              <input
                type="date"
                value={qoplaFrom}
                onChange={e => setQoplaFrom(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Till <span className="text-slate-400 dark:text-zinc-500">(valfritt)</span>
              <input
                type="date"
                value={qoplaTo}
                onChange={e => setQoplaTo(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
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
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <Play size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Kör dinkassa</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Startar dinkassa-hämtningen (via GitHub Actions) och bokför mot kopplade bolag.
            Tomt = gårdagen. Ange Från för en dag, eller Från + Till för en period. En verifikation per kassa per dag.
            Redan bokförda dagar hoppas över. Resultat syns i Senaste körningar om ~1–2 min.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Från
              <input
                type="date"
                value={dinkassaFrom}
                onChange={e => setDinkassaFrom(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Till <span className="text-slate-400 dark:text-zinc-500">(valfritt)</span>
              <input
                type="date"
                value={dinkassaTo}
                onChange={e => setDinkassaTo(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
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

      {/* Kör Woso Emporia (ancon) */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <Play size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Kör Woso Emporia</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Hämtar Woso Emporia (ancon) och bokför mot kopplat bolag. Tomt = idag, eller Från (+ Till) för en period.
            En verifikation per dag. Redan bokförda dagar hoppas. Resultat visas direkt.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Från
              <input
                type="date"
                value={anconFrom}
                onChange={e => setAnconFrom(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
              />
            </label>
            <label className="text-xs text-slate-500 dark:text-zinc-400">
              Till <span className="text-slate-400 dark:text-zinc-500">(valfritt)</span>
              <input
                type="date"
                value={anconTo}
                onChange={e => setAnconTo(e.target.value)}
                className="block mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
              />
            </label>
            <button
              onClick={handleRunAncon}
              disabled={runAncon.isPending}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {runAncon.isPending ? <Spinner size={14} className="border-white border-t-white/30" /> : <Play size={14} />}
              Kör Woso Emporia
            </button>
          </div>
        </div>
      </section>

      {/* Importera SIE-fil (dinkassa m.fl.) */}
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <FileUp size={16} className="text-slate-400 dark:text-zinc-500" />
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Importera SIE-fil</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            För kassasystem utan API (t.ex. dinkassa): ladda ner <code className="text-slate-700 dark:text-zinc-200">.se</code>-filen
            och bokför den mot valt bolag. Samma verifikationer hoppas över automatiskt — ingen dubbelbokföring.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={importCompany}
              onChange={e => setImportCompany(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-sm bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
            >
              <option value="">— välj bolag —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              importCompany && !importSie.isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed'
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
      <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <ReceiptText size={16} className="text-slate-400 dark:text-zinc-500" />
            <h2 className="font-semibold text-slate-900 dark:text-zinc-100 text-sm">Senaste körningar</h2>
          </div>
          {postingShops.length > 0 && (
            <select
              value={postingShop}
              onChange={e => { setPostingShop(e.target.value); setPostingVisible(25) }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-zinc-800 text-xs bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900 focus:border-indigo-300 dark:focus:border-indigo-500"
            >
              <option value="">Alla butiker</option>
              {postingShops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="p-5">
          {filteredPostings.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-zinc-500 py-2">
              {postings.length === 0 ? 'Inga körningar ännu.' : 'Inga körningar för vald butik.'}
            </p>
          ) : (
            <>
              <div className="divide-y divide-slate-50 dark:divide-zinc-800">
                {visiblePostings.map(p => {
                  const bolag = companyNameById.get(companyOfPosting(p) ?? '')
                  const detail = [bolag, p.message].filter(Boolean).join(' · ')
                  return (
                    <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                      <StatusBadge status={p.status} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-700 dark:text-zinc-200 truncate">
                          {nameByShop.get(p.qopla_shop_id) ?? p.qopla_shop_id}
                          <span className="text-slate-400 dark:text-zinc-500 font-normal"> · {p.business_date}</span>
                        </div>
                        {detail && <div className="text-xs text-slate-400 dark:text-zinc-500 truncate">{detail}</div>}
                      </div>
                      {p.voucher_number && (
                        <span className={`shrink-0 text-xs font-mono ${p.status === 'deleted' ? 'text-red-400 line-through' : 'text-slate-500 dark:text-zinc-400'}`}>
                          {p.voucher_number}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-50 dark:border-zinc-800 text-xs text-slate-400 dark:text-zinc-500">
                <span>Visar {visiblePostings.length} av {filteredPostings.length}</span>
                {filteredPostings.length > postingVisible && (
                  <button
                    onClick={() => setPostingVisible(v => v + 25)}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-medium hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Visa fler
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <Modal open={!!runModal} onClose={() => setRunModal(null)} title={runModal?.title ?? 'Körning'}>
        {runModal && <RunResults results={runModal.results} />}
      </Modal>
    </div>
  )
}

function RunResults({ results }: { results: RunRow[] }) {
  const ok = results.filter(r => r.status === 'ok').length
  const skip = results.filter(r => r.status === 'skipped').length
  const err = results.filter(r => r.status === 'error' || r.status === 'unmapped').length
  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-sm">
        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{ok} bokförda</span>
        <span className="text-slate-400 dark:text-zinc-500">{skip} hoppade</span>
        {err > 0 && <span className="text-red-500 dark:text-red-400 font-semibold">{err} fel</span>}
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-zinc-500 py-2">Inget att visa.</p>
      ) : (
        <div className="divide-y divide-slate-50 dark:divide-zinc-800 max-h-[55vh] overflow-auto -mx-1 px-1">
          {results.map((r, i) => {
            const num = r.voucherNumbers?.length ? r.voucherNumbers.join(', ') : r.voucher
            return (
              <div key={i} className="flex items-center gap-3 py-2 text-sm">
                <StatusBadge status={r.status} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-700 dark:text-zinc-200 truncate">
                    {r.shop || r.date || '—'}
                    {r.shop && r.date && <span className="text-slate-400 dark:text-zinc-500 font-normal"> · {r.date}</span>}
                  </div>
                  {r.message && r.status !== 'ok' && <div className="text-xs text-slate-400 dark:text-zinc-500 truncate">{r.message}</div>}
                </div>
                {num && <span className="shrink-0 text-xs font-mono text-slate-500 dark:text-zinc-400">{num}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok')
    return <span className="shrink-0 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={15} /></span>
  if (status === 'error')
    return <span className="shrink-0 inline-flex items-center gap-1 text-red-500 dark:text-red-400"><AlertCircle size={15} /></span>
  if (status === 'deleted')
    return <span className="shrink-0 inline-flex items-center gap-1 text-red-500 dark:text-red-400" title="Borttagen i Fortnox"><Ban size={15} /></span>
  return <span className="shrink-0 inline-flex items-center gap-1 text-slate-300 dark:text-zinc-600"><MinusCircle size={15} /></span>
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
          className="flex-1 px-2.5 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900"
        />
      ) : (
        <span className="flex-1 text-sm text-slate-700 dark:text-zinc-200">{company.name}</span>
      )}
      {connected ? (
        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
          <Link2 size={13} /> Ansluten
        </span>
      ) : (
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50 transition-colors"
          title="Anslut bolaget till Fortnox"
        >
          {connecting ? <Spinner size={12} /> : <Plug size={13} />} Anslut
        </button>
      )}
      <button
        onClick={() => setEditing(true)}
        className="p-1.5 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
        title="Byt namn"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={handleDelete}
        className="p-1.5 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
        title="Ta bort"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
