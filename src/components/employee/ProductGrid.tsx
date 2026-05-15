import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Package } from 'lucide-react'
import { useProducts } from '../../hooks/useProducts'
import { useVendors } from '../../hooks/useMetadata'
import ProductCard from './ProductCard'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'

export default function ProductGrid({ locationId }: { locationId: string }) {
  const { data: products, isLoading, error } = useProducts(true, locationId)
  const { data: vendorList } = useVendors()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [navVisible, setNavVisible] = useState(true)
  const lastScrollY = useRef(0)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Build vendor list: prefer sort_order from vendorList, fall back to order from products
  const vendors = useMemo(() => {
    if (!products) return []
    const productVendorSet = new Set(products.map(p => p.vendor || ''))
    let named: string[]
    if (vendorList?.length) {
      named = vendorList.filter(v => productVendorSet.has(v.name)).map(v => v.name)
    } else {
      // vendorList not loaded yet or migration not run — derive from products
      named = [...new Set(products.map(p => p.vendor).filter((v): v is string => !!v))]
    }
    if (productVendorSet.has('')) named.push('General')
    return named
  }, [products, vendorList])

  // Hide nav on scroll down, reveal on scroll up
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - lastScrollY.current
      if (Math.abs(delta) > 4) {
        setNavVisible(delta < 0 || y < 100)
        lastScrollY.current = y
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToVendor = (vendor: string) => {
    sectionRefs.current[vendor]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const toggleCollapse = (vendor: string) =>
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(vendor) ? next.delete(vendor) : next.add(vendor)
      return next
    })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner size={32} /></div>
  if (error) return <div className="text-center py-16 text-red-500 text-sm">Failed to load products. Please refresh.</div>
  if (!products?.length) return <EmptyState icon={Package} title="No products available" description="Ask an admin to add products." />

  return (
    <div>
      {/* Sticky vendor anchor nav — hides on scroll down */}
      {vendors.length > 1 && (
        <div
          className={`sticky top-[69px] z-20 -mx-4 transition-opacity duration-200 ${
            navVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="bg-white/95 backdrop-blur-sm border-b border-slate-100 px-4 py-2.5 flex gap-2 overflow-x-auto">
            {vendors.map(v => (
              <button
                key={v}
                onClick={() => scrollToVendor(v)}
                className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700 transition-colors whitespace-nowrap shrink-0"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Vendor sections */}
      <div className="space-y-4 pt-4 pb-4">
        {vendors.map(vendor => {
          const vendorProducts = products.filter(p => (p.vendor || 'General') === vendor)
          const isCollapsed = collapsed.has(vendor)

          return (
            <div
              key={vendor}
              ref={el => { sectionRefs.current[vendor] = el }}
              className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden scroll-mt-[120px]"
            >
              <button
                onClick={() => toggleCollapse(vendor)}
                className="w-full flex items-center justify-between px-4 py-2.5 border-b border-slate-50 bg-slate-50/60 hover:bg-slate-100/60 transition-colors"
              >
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{vendor}</h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">{vendorProducts.length}</span>
                  <ChevronDown
                    size={14}
                    className={`text-slate-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </div>
              </button>
              {!isCollapsed && (
                <div className="divide-y divide-slate-50">
                  {vendorProducts.map(p => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
