import { create } from 'zustand'
import type { Toast, ToastType } from '@/types'

interface AppState {
  toasts: Toast[]
  addToast: (msg: string, type: ToastType, duration?: number) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useStore = create<AppState>((set, get) => ({
  toasts: [],

  addToast: (msg, type, duration = 3000) => {
    const id = String(++toastCounter)
    set(s => ({ toasts: [...s.toasts, { id, message: msg, type, duration }] }))
    setTimeout(() => get().removeToast(id), duration + 500)
  },

  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))
