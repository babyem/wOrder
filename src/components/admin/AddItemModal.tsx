import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Minus, Plus, Search, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../ui/Modal'
import type { OrderWithDetails, Product } from '../../types'
import { useProducts } from '../../hooks/useProducts'
import { useAddOrderItem } from '../../hooks/useOrders'

interface Props {
  order: OrderWithDetails
  open: boolean
  onClose: () => void
  orderVendors: string[]                 // leverantörer på kortet — deras produkter listas först
  effectiveVendor: (item: OrderWithDetails['items'][number]) => string
  onAdded: (vendor: string) => void      // leverantören raden hamnade hos
}

// Portal: kortet ligger i en transformerad kolumn (dnd-kit/framer), där fixed-position
// annars ritas relativt kolumnen. stopPropagation: React-events bubblar genom portalen
// upp till kortets klickhanterare (markering av leverantörskort).
export default function AddItemModal({ open, onClose, ...rest }: Props) {
  return createPortal(
    <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <Modal open={open} onClose={onClose} title="Lägg till produkt">
        <Picker {...rest} onDone={onClose} />
      </Modal>
    </div>,
    document.body,
  )
}

const MAX_RESULTS = 60

// order_items.quantity är integer i databasen — bara heltal
const parseQty = (s: string) => (/^\d+$/.test(s.trim()) ? parseInt(s, 10) : NaN)

function Picker({ order, orderVendors, effectiveVendor, onAdded, onDone }: Omit<Props, 'open' | 'onClose'> & { onDone: () => void }) {
  // Monteras bara när modalen är öppen, så produkterna hämtas inte för varje kort
  const { data: products, isLoading } = useProducts(true, order.location_id)
  const addItem = useAddOrderItem()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const [qty, setQty] = useState('1')

  const qtyInOrder = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of order.items) m.set(i.product_id, (m.get(i.product_id) ?? 0) + i.quantity)
    return m
  }, [order.items])

  const vendorKey = orderVendors.join('|')
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const onCard = new Set(vendorKey.split('|'))
    const rank = (p: Product) => (onCard.has(p.vendor) ? 0 : 1)
    return (products ?? [])
      .filter(p => !q
        || p.name.toLowerCase().includes(q)
        || !!p.vendor_name?.toLowerCase().includes(q)
        || p.vendor.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b)) // stabil sortering: sort_order behålls inom grupperna
      .slice(0, MAX_RESULTS)
  }, [products, query, vendorKey])

  const n = parseQty(qty)
  const valid = !!selected && Number.isFinite(n) && n > 0

  const pick = (p: Product) => { setSelected(p); setQty('1') }
  const step = (d: number) => setQty(String(Math.max(1, (Number.isFinite(n) ? n : 1) + d)))

  const submit = async () => {
    if (!valid || !selected || addItem.isPending) return
    // Slå ihop med befintlig rad — men inte med en överstruken (exkluderad) rad
    const existing = order.items.find(i => i.product_id === selected.id && !i.notify_excluded)
    try {
      await addItem.mutateAsync({
        orderId: order.id,
        productId: selected.id,
        quantity: n,
        mergeInto: existing ? { id: existing.id, quantity: existing.quantity } : undefined,
      })
      toast.success(existing
        ? `${selected.name}: ${existing.quantity} → ${existing.quantity + n} ${selected.unit}`
        : `${selected.name} tillagd (${n} ${selected.unit})`)
      onAdded(existing ? effectiveVendor(existing) : selected.vendor)
      onDone()
    } catch (e) {
      toast.error(`Kunde inte lägga till: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="-mx-2 -my-2">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 pointer-events-none" />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && results.length === 1) pick(results[0]) }}
          placeholder="Sök produkt eller leverantör…"
          className="w-full h-11 pl-9 pr-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-base text-slate-900 dark:text-zinc-100 placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div className="mt-2 max-h-[45vh] overflow-y-auto overscroll-contain -mx-1 px-1">
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin text-slate-400" /></div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400 dark:text-zinc-500">
            {query.trim() ? `Ingen produkt matchar "${query.trim()}"` : 'Inga produkter'}
          </p>
        ) : (
          <div className="space-y-0.5">
            {results.map(p => {
              const sel = selected?.id === p.id
              const inOrder = qtyInOrder.get(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[48px] rounded-xl text-left transition-colors ${sel ? 'bg-indigo-600 text-white' : 'hover:bg-slate-50 dark:hover:bg-zinc-800 text-slate-800 dark:text-zinc-100'}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className={`text-xs truncate ${sel ? 'text-indigo-100' : 'text-slate-400 dark:text-zinc-500'}`}>{p.vendor} · {p.unit}</p>
                  </div>
                  {inOrder != null && (
                    <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${sel ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'}`}>
                      i ordern: {inOrder}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-zinc-800 space-y-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-zinc-100 truncate">
            {selected.name} <span className="font-normal text-slate-400 dark:text-zinc-500">· {selected.vendor}</span>
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => step(-1)} aria-label="Minska antal"
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors">
                <Minus size={16} />
              </button>
              <input
                value={qty}
                onChange={e => setQty(e.target.value)}
                onFocus={e => e.target.select()}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                inputMode="numeric"
                aria-label="Antal"
                className="w-14 h-11 text-center text-base font-semibold tabular-nums rounded-xl border border-slate-200 dark:border-zinc-700 bg-transparent text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button onClick={() => step(1)} aria-label="Öka antal"
                className="w-11 h-11 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors">
                <Plus size={16} />
              </button>
              <span className="text-xs text-slate-400 dark:text-zinc-500 pl-1">{selected.unit}</span>
            </div>
            <button
              onClick={submit}
              disabled={!valid || addItem.isPending}
              className="flex-1 h-11 flex items-center justify-center rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {addItem.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Lägg till'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
