import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'
import LocationListPage from './pages/LocationListPage'
import OrderPage from './pages/OrderPage'
import LoginPage from './pages/admin/LoginPage'
import AdminLayout from './components/admin/AdminLayout'
import OrdersPage from './pages/admin/OrdersPage'
import ProductsPage from './pages/admin/ProductsPage'
import SettingsPage from './pages/admin/SettingsPage'
import LocationPage from './pages/admin/LocationPage'
import ReportsPage from './pages/admin/ReportsPage'
import FortnoxPage from './pages/admin/FortnoxPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore(s => s.user)
  const initialized = useAuthStore(s => s.initialized)
  // Wait for the initial session check before deciding — otherwise a page refresh
  // briefly sees user=null and redirects away from the current admin page.
  if (!initialized) return null
  if (!user) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

export default function App() {
  const setUser = useAuthStore(s => s.setUser)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [setUser])

  return (
    <Routes>
      <Route path="/" element={<LocationListPage />} />
      <Route path="/order/:slug" element={<OrderPage />} />
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
        <Route index element={<Navigate to="orders" replace />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="fortnox" element={<FortnoxPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="locations/:locationId" element={<LocationPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
