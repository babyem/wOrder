import { motion } from 'framer-motion'
import { MapPin } from 'lucide-react'
import { useLocations } from '../../hooks/useLocations'
import Spinner from '../ui/Spinner'

interface Props {
  selected: string
  onSelect: (id: string) => void
}

export default function LocationSelector({ selected, onSelect }: Props) {
  const { data: locations, isLoading } = useLocations()

  if (isLoading) {
    return <div className="flex justify-center py-8"><Spinner /></div>
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <MapPin size={16} className="text-slate-400 dark:text-zinc-500" />
        <span className="text-sm font-medium text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Select Location</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {locations?.map(loc => (
          <motion.button
            key={loc.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(loc.id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              selected === loc.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none'
                : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-800 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
          >
            {loc.name}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
