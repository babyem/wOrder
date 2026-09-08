import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
}

export default function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
        <Icon size={24} className="text-slate-400 dark:text-zinc-500" />
      </div>
      <p className="text-slate-700 dark:text-zinc-200 font-medium">{title}</p>
      {description && <p className="text-slate-400 dark:text-zinc-500 text-sm mt-1">{description}</p>}
    </div>
  )
}
