import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ShoppingBag, Package, Settings, LogOut, ChefHat, Menu, X, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useQoplaSales } from '../../hooks/useQoplaSales'
import { motion, AnimatePresence } from 'framer-motion'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag, end: false },
  { to: '/admin/products', label: 'Products', icon: Package, end: false },
  { to: '/admin/settings', label: 'Settings', icon: Settings, end: false },
]

function QoplaSalesWidget() {
  const { data, isLoading, isError } = useQoplaSales()
  return (
    <div className="mx-1 mt-6 mb-2 rounded-xl bg-slate-50 border border-slate-100 p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <TrendingUp size={13} className="text-indigo-500" />
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Idag</span>
      </div>
      {isLoading && (
        <div className="space-y-1.5">
          {[1,2,3].map(i => (
            <div key={i} className="h-3 bg-slate-200 rounded animate-pulse" style={{ width: `${60+i*10}%` }} />
          ))}
        </div>
      )}
      {isError && <p className="text-xs text-red-400">Kunde inte hämta data</p>}
      {data && (
        <div className="space-y-1.5">
          {data.map(r => (
            <div key={r.shopId} className="flex justify-between items-baseline gap-1">
              <span className="text-xs text-slate-500 truncate">{r.restaurant}</span>
              <span className="text-xs font-semibold text-slate-700 shrink-0">{r.sales.toLocaleString('sv-SE')} kr</span>
            </div>
          ))}
          <div className="border-t border-slate-200 pt-1.5 mt-1.5 flex justify-between items-baseline">
            <span className="text-xs font-semibold text-slate-600">Totalt</span>
            <span className="text-xs font-bold text-indigo-600">{data.reduce((s,r)=>s+r.sales,0).toLocaleString('sv-SE')} kr</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminLayout() {
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin/login')
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
    }`

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-slate-100 p-4 shrink-0">
        <div className="flex items-center gap-2.5 px-1 mb-8">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <ChefHat size={16} className="text-white" />
          </div>
          <span className="font-bold text-slate-900 text-sm">Staff Orders</span>
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white border-b border-slate-100 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ChefHat size={16} className="text-white" />
            </div>
            <span className="font-bold text-slate-900 text-sm">Staff Orders</span>
          </div>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <Menu size={20} className="text-slate-600" />
          </button>
        </header>

        {/* Mobile nav drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                className="fixed inset-0 bg-black/40 z-40 md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileOpen(false)}
              />
              <motion.div
                className="fixed left-0 top-0 bottom-0 w-64 bg-white z-50 p-4 md:hidden"
                initial={{ x: -256 }}
                animate={{ x: 0 }}
                exit={{ x: -256 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              >
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <ChefHat size={16} className="text-white" />
                    </div>
                    <span className="font-bold text-slate-900 text-sm">Staff Orders</span>
                  </div>
                  <button onClick={() => setMobileOpen(false)} className="p-1 rounded-lg hover:bg-slate-100">
                    <X size={18} className="text-slate-500" />
                  </button>
                </div>
                <nav className="space-y-1">
                  {navItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={navLinkClass}
                      onClick={() => setMobileOpen(false)}
                    >
                      <item.icon size={18} />
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all mt-4 w-full"
                >
                  <LogOut size={18} />
                  Sign Out
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main className="flex-1 p-4 md:p-6 pb-16 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
