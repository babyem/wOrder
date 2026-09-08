import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ShoppingBag, Package, Settings, LogOut, ChefHat, Menu, X, FileBarChart, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { QoplaSalesWidget } from '../../plugins/qopla/QoplaSalesWidget'
import { motion, AnimatePresence } from 'framer-motion'
import PushSubscribeButton from './PushSubscribeButton'
import ThemeToggle from '../ui/ThemeToggle'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag, end: false },
  { to: '/admin/products', label: 'Products', icon: Package, end: false },
  { to: '/admin/reports', label: 'Rapporter', icon: FileBarChart, end: false },
  { to: '/admin/fortnox', label: 'Fortnox', icon: ReceiptText, end: false },
  { to: '/admin/settings', label: 'Settings', icon: Settings, end: false },
]

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
        ? 'bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300'
        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 hover:bg-slate-100 dark:hover:bg-zinc-800'
    }`

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white dark:bg-zinc-900 border-r border-slate-100 dark:border-zinc-800 p-4 shrink-0">
        <div className="flex items-center justify-between px-1 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ChefHat size={16} className="text-white" />
            </div>
            <span className="font-bold text-slate-900 dark:text-zinc-100 text-sm">Staff Orders</span>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle compact />
            <PushSubscribeButton compact />
            <button
              onClick={handleLogout}
              title="Logga ut"
              className="p-2 rounded-xl text-slate-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>

        <div className="mt-4">
          <NavLink
            to="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm"
          >
            <ChefHat size={18} />
            Staff Order
          </NavLink>
        </div>
        <div className="border-t border-slate-100 dark:border-zinc-800 my-3" />

        <nav className="space-y-1">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon size={18} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <QoplaSalesWidget />

        <div className="flex-1" />
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ChefHat size={16} className="text-white" />
            </div>
            <span className="font-bold text-slate-900 dark:text-zinc-100 text-sm">Staff Orders</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle compact />
            <PushSubscribeButton compact />
            <button
              onClick={handleLogout}
              title="Logga ut"
              className="p-2 rounded-xl text-slate-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              <LogOut size={18} />
            </button>
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <Menu size={20} className="text-slate-600 dark:text-zinc-300" />
            </button>
          </div>
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
                className="fixed left-0 top-0 bottom-0 w-64 bg-white dark:bg-zinc-900 z-50 p-4 md:hidden flex flex-col"
                initial={{ x: -256 }}
                animate={{ x: 0 }}
                exit={{ x: -256 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                      <ChefHat size={16} className="text-white" />
                    </div>
                    <span className="font-bold text-slate-900 dark:text-zinc-100 text-sm">Staff Orders</span>
                  </div>
                  <button onClick={() => setMobileOpen(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800">
                    <X size={18} className="text-slate-500 dark:text-zinc-400" />
                  </button>
                </div>

                <div className="flex items-center gap-1 mb-4 pb-4 border-b border-slate-100 dark:border-zinc-800">
                  <ThemeToggle compact />
            <PushSubscribeButton compact />
                  <button
                    onClick={handleLogout}
                    title="Logga ut"
                    className="p-2 rounded-xl text-slate-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                  >
                    <LogOut size={18} />
                  </button>
                </div>

                <NavLink
                  to="/"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm"
                >
                  <ChefHat size={18} />
                  Staff Order
                </NavLink>
                <div className="border-t border-slate-100 dark:border-zinc-800 my-3" />

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

                <QoplaSalesWidget />

                <div className="flex-1" />
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
