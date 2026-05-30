import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'

interface AuthStore {
  user: User | null
  initialized: boolean // true once the initial session check has resolved
  setUser: (user: User | null) => void
}

export const useAuthStore = create<AuthStore>(set => ({
  user: null,
  initialized: false,
  setUser: user => set({ user, initialized: true }),
}))
