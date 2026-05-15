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
        <MapPin size={16} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-500 uppercase tracking-wide">Select Location</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {locations?.map(loc => (
          <motion.button
            key={loc.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(loc.id)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              selected === loc.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            {loc.name}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
