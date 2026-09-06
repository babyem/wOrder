import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Check, ChevronDown, Plus } from 'lucide-react'
import { useCartStore } from '../../store/cartStore'
import { useProducts } from '../../hooks/useProducts'
import { useOrderHistoryStats } from '../../hooks/useOrderHistory'
import { suggestUsualOrder, type VendorSuggestion } from '../../lib/suggest'
import type { Product } from '../../types'

/**
 * "Vanlig beställning": per leverantör de produkter butiken nästan alltid tar,
 * med typiskt antal för dagens veckodag. En knapp fyller korgen.
 * Räknas fram lokalt från butikens 90-dagarshistorik (useOrderHistoryStats).
 */
export default function SuggestedOrder({ locationId }: { locationId: string }) {
  const { stats, hasData } = useOrderHistoryStats(locationId)
  const { data: products } = useProducts(true, locationId)
  const items = useCartStore(s => s.items)
  const setItem = useCartStore(s => s.setItem)
  const [expanded, setExpanded] = useState<string | null>(null)

  const productById = useMemo(() => new Map((products ?? []).map(p => [p.id, p])), [products])

  // Bara produkter som fortfarande finns och är aktiva för butiken
  const suggestions = useMemo(() => {
    if (!hasData || !products) return []
    return suggestUsualOrder(stats)
      .map(s => ({ ...s, items: s.items.filter(i => productById.has(i.product_id)) }))
      .filter(s => s.items.length > 0)
  }, [stats, hasData, products, productById])

  if (!suggestions.length) return null

  const inCart = (productId: string) => items.find(i => i.product_id === productId)?.quantity ?? 0
  const allInCart = (s: VendorSuggestion) => s.items.every(i => inCart(i.product_id) > 0)

  const addAll = (s: VendorSuggestion) => {
    for (const i of s.items) {
      const p = productById.get(i.product_id)
      if (p && inCart(i.product_id) === 0) setItem(p, i.quantity)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50/60 border-b border-indigo-50">
        <Sparkles size={14} className="text-indigo-500" />
        <h3 className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">Vanlig beställning</h3>
        <span className="ml-auto text-[10px] text-indigo-400">baserat på 90 dagar</span>
      </div>

      <div className="divide-y divide-slate-50">
        {suggestions.map(s => {
          const done = allInCart(s)
          const open = expanded === s.vendor
          return (
            <div key={s.vendor}>
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(open ? null : s.vendor)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-900 text-sm truncate">{s.vendor}</span>
                    <ChevronDown size={12} className={`text-slate-300 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    {s.items.map(i => `${productById.get(i.product_id)!.name} ${i.quantity}`).join(' · ')}
                  </p>
                </button>
                <button
                  onClick={() => addAll(s)}
                  disabled={done}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                    done
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                >
                  {done ? <><Check size={13} /> I korgen</> : <><Plus size={13} /> Lägg i korgen</>}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-3 space-y-1">
                      {s.items.map(i => {
                        const p = productById.get(i.product_id) as Product
                        const qty = inCart(i.product_id)
                        return (
                          <div key={i.product_id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 min-w-0 truncate text-slate-700">{p.name}</span>
                            <span className="text-slate-400 tabular-nums shrink-0">
                              {i.quantity} {i.unit ?? p.unit} · {i.orders} av {i.vendorOrders}
                            </span>
                            <button
                              onClick={() => setItem(p, i.quantity)}
                              disabled={qty > 0}
                              className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                                qty > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700'
                              }`}
                              title={qty > 0 ? `${qty} i korgen` : 'Lägg till'}
                            >
                              {qty > 0 ? <Check size={11} /> : <Plus size={11} />}
                            </button>
                          </div>
                        )
                      })}
                      <p className="text-[10px] text-slate-400 pt-1">
                        Senast {new Date(s.lastOrdered).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })} · {s.basedOn} beställningar
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
