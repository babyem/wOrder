import { useOrders } from '../../hooks/useOrders'
import { useLocations } from '../../hooks/useLocations'
import { ShoppingBag, Clock, CheckCircle, MapPin } from 'lucide-react'
import Spinner from '../../components/ui/Spinner'

export default function DashboardPage() {
  const { data: orders, isLoading } = useOrders()
  const { data: locations } = useLocations()

  const pending = orders?.filter(o => o.status === 'pending') ?? []
  const done = orders?.filter(o => o.status === 'done') ?? []
  const today = orders?.filter(o => {
    const d = new Date(o.created_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  }) ?? []

  const stats = [
    { label: 'Total Orders', value: orders?.length ?? 0, icon: ShoppingBag, color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-50 dark:bg-indigo-950' },
    { label: 'Pending', value: pending.length, icon: Clock, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950' },
    { label: 'Completed', value: done.length, icon: CheckCircle, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950' },
    { label: "Today's Orders", value: today.length, icon: MapPin, color: 'text-slate-600 dark:text-zinc-300', bg: 'bg-slate-100 dark:bg-zinc-800' },
  ]

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size={32} /></div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Dashboard</h1>
        <p className="text-slate-400 dark:text-zinc-500 text-sm mt-1">Overview of all orders</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(stat => (
          <div key={stat.label} className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 p-4 shadow-sm">
            <div className={`w-10 h-10 ${stat.bg} rounded-xl flex items-center justify-center mb-3`}>
              <stat.icon size={20} className={stat.color} />
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-zinc-100">{stat.value}</p>
            <p className="text-sm text-slate-400 dark:text-zinc-500 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900 dark:text-zinc-100 mb-4">Orders by Location</h2>
          <div className="space-y-3">
            {locations?.map(loc => {
              const count = orders?.filter(o => o.location_id === loc.id).length ?? 0
              const pct = orders?.length ? Math.round((count / orders.length) * 100) : 0
              return (
                <div key={loc.id}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 dark:text-zinc-300">{loc.name}</span>
                    <span className="text-slate-400 dark:text-zinc-500">{count} orders</span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {!locations?.length && <p className="text-slate-400 dark:text-zinc-500 text-sm">No locations found.</p>}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 p-5 shadow-sm">
          <h2 className="font-semident text-slate-900 dark:text-zinc-100 mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {orders?.slice(0, 5).map(o => (
              <div key={o.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-zinc-100">{o.employee?.name ?? 'Unknown'}</p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500">{o.location?.name} · {new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  o.status === 'pending' ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300' : o.status === 'stopped' ? 'bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300' : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300'
                }`}>
                  {o.status === 'stopped' ? 'ingen beställning' : o.status}
                </span>
              </div>
            ))}
            {!orders?.length && <p className="text-slate-400 dark:text-zinc-500 text-sm">No orders yet.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
