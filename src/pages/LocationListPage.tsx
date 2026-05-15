import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChefHat, MapPin, ChevronRight } from 'lucide-react'
import { useAdminLocations } from '../hooks/useAdminData'
import { toSlug } from '../lib/slug'
import Spinner from '../components/ui/Spinner'

export default function LocationListPage() {
  const navigate = useNavigate()
  const { data: locations, isLoading } = useAdminLocations()

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-lg mx-auto px-5 py-5 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <ChefHat size={22} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">Staff Orders</h1>
            <p className="text-xs text-slate-400">Select your location to get started</p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-5 py-8">
        {isLoading ? (
          <div className="flex justify-center py-20"><Spinner size={32} /></div>
        ) : (
          <div className="space-y-3">
            {locations?.map((loc, i) => (
              <motion.button
                key={loc.id}
                onClick={() => navigate(`/order/${toSlug(loc.name)}`)}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, type: 'spring', damping: 20, stiffness: 260 }}
                className="w-full flex items-center gap-4 bg-white rounded-2xl px-5 py-4 border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 hover:-translate-y-0.5 active:scale-[0.98] transition-all text-left group"
              >
                <div className="w-11 h-11 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-indigo-100 transition-colors">
                  <MapPin size={20} className="text-indigo-500" />
                </div>
                <span className="flex-1 font-semibold text-slate-800 text-base">{loc.name}</span>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0" />
              </motion.button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
