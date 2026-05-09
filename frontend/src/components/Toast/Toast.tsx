import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { Toast as ToastType } from '../../types'
import styles from './Toast.module.css'

function ToastItem({ toast }: { toast: ToastType }) {
  const removeToast = useStore(s => s.removeToast)
  const [out, setOut] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setOut(true), toast.duration - 200)
    const t2 = setTimeout(() => removeToast(toast.id), toast.duration + 100)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [])

  const icons: Record<string, string> = {
    success: `<circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>`,
    error: `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
    warn: `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
    info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
  }

  return (
    <div className={`${styles.toast} ${styles[toast.type]} ${out ? styles.out : ''}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: icons[toast.type] || icons.info }} />
      <span className={styles.text}>{toast.message}</span>
    </div>
  )
}

export default function Toast() {
  const toasts = useStore(s => s.toasts)
  return (
    <div style={{ position: 'fixed', top: 70, right: 16, zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}
