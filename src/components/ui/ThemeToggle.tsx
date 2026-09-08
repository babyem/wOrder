import { Sun, Moon, Monitor } from 'lucide-react'
import { useThemeStore, type ThemePreference } from '../../store/themeStore'

const ORDER: ThemePreference[] = ['light', 'dark', 'system']
const LABEL: Record<ThemePreference, string> = { light: 'Ljust', dark: 'Mörkt', system: 'Följ systemet' }
const ICON = { light: Sun, dark: Moon, system: Monitor }

/** Cycles light → dark → system. `compact` = icon only (sidebar/header), otherwise icon + label. */
export default function ThemeToggle({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const preference = useThemeStore(s => s.preference)
  const setPreference = useThemeStore(s => s.setPreference)
  const Icon = ICON[preference]
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]
  const title = `Tema: ${LABEL[preference]} — klicka för ${LABEL[next].toLowerCase()}`

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      title={title}
      aria-label={title}
      className={compact
        ? `p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors ${className}`
        : `flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors ${className}`}
    >
      <Icon size={compact ? 18 : 14} />
      {!compact && <span>{LABEL[preference]}</span>}
    </button>
  )
}
