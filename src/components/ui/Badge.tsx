interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'indigo'
}

const variants = {
  default: 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300',
  success: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
  danger: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400',
  indigo: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300',
}

export default function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  )
}
