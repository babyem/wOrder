import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button for destructive actions */
  danger?: boolean
}

interface ConfirmState {
  open: boolean
  options: ConfirmOptions
  resolve: ((ok: boolean) => void) | null
  ask: (options: ConfirmOptions) => Promise<boolean>
  answer: (ok: boolean) => void
}

// In-app replacement for window.confirm(): `await confirmDialog({...})`.
// The dialog itself is <ConfirmDialog />, mounted once in AdminLayout.
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: { title: '' },
  resolve: null,
  ask: options => new Promise<boolean>(resolve => {
    get().resolve?.(false) // a second ask cancels the first
    set({ open: true, options, resolve })
  }),
  answer: ok => {
    get().resolve?.(ok)
    set({ open: false, resolve: null })
  },
}))

export const confirmDialog = (options: ConfirmOptions) => useConfirmStore.getState().ask(options)
