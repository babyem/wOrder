import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* private mode etc. */ }
  return 'system'
}

function resolve(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
}

function apply(pref: ThemePreference) {
  const dark = resolve(pref) === 'dark'
  document.documentElement.classList.toggle('dark', dark)
  // Browser chrome (PWA status bar, mobile address bar) follows the page.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#18181b' : '#4f46e5')
}

interface ThemeStore {
  preference: ThemePreference
  resolved: 'light' | 'dark'
  setPreference: (p: ThemePreference) => void
}

export const useThemeStore = create<ThemeStore>(set => ({
  preference: readStored(),
  resolved: resolve(readStored()),
  setPreference: preference => {
    try { localStorage.setItem(STORAGE_KEY, preference) } catch { /* ignore */ }
    apply(preference)
    set({ preference, resolved: resolve(preference) })
  },
}))

// Apply once at module load (before first render) so there is no light flash,
// and follow OS changes while the user is on "system".
apply(useThemeStore.getState().preference)
media.addEventListener('change', () => {
  const { preference } = useThemeStore.getState()
  if (preference === 'system') {
    apply(preference)
    useThemeStore.setState({ resolved: resolve(preference) })
  }
})
