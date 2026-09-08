import { motion } from 'framer-motion'
import { User } from 'lucide-react'
import { useEmployees } from '../../hooks/useEmployees'
import Spinner from '../ui/Spinner'

interface Props {
  locationId: string
  selected: string
  onSelect: (id: string) => void
}

export default function EmployeeSelector({ locationId, selected, onSelect }: Props) {
  const { data: employees, isLoading } = useEmployees(locationId)

  if (isLoading) {
    return <div className="flex justify-center py-8"><Spinner /></div>
  }

  if (!employees?.length) {
    return (
      <div className="text-center py-6 text-slate-400 dark:text-zinc-500 text-sm">
        No employees found for this location.
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <User size={16} className="text-slate-400 dark:text-zinc-500" />
        <span className="text-sm font-medium text-slate-500 dark:text-zinc-400 uppercase tracking-wide">Who are you?</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {employees.map(emp => (
          <motion.button
            key={emp.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => onSelect(emp.id)}
            className={`px-5 py-3 rounded-2xl text-base font-semibold transition-all ${
              selected === emp.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 dark:shadow-none'
                : 'bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 border-2 border-slate-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-indigo-800 hover:text-indigo-600 dark:hover:text-indigo-400'
            }`}
          >
            {emp.name}
          </motion.button>
        ))}
      </div>
    </div>
  )
}
