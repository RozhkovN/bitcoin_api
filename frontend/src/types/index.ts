export type ToastType = 'success' | 'error' | 'info' | 'warn'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
}
