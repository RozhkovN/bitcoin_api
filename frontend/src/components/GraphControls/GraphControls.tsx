import { useStore } from '../../store'
import styles from './GraphControls.module.css'

interface Props {
  onReset: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onCenter: () => void
}

export default function GraphControls({ onReset, onZoomIn, onZoomOut, onCenter }: Props) {
  const { mergedGraph } = useStore()
  const visible = !!mergedGraph

  return (
    <div className={`${styles.controls} ${visible ? styles.visible : ''}`}>
      <GcBtn onClick={onReset} title="Сбросить камеру">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </GcBtn>
      <GcBtn onClick={onZoomIn} title="Приблизить">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="11" y1="8" x2="11" y2="14"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </GcBtn>
      <GcBtn onClick={onZoomOut} title="Отдалить">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </GcBtn>
      <GcBtn onClick={onCenter} title="Центрировать">
        <circle cx="12" cy="12" r="3"/>
        <path d="M3 12h2M19 12h2M12 3v2M12 19v2"/>
      </GcBtn>
    </div>
  )
}

function GcBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="gc-btn" onClick={onClick} title={title} style={{
      width: 32, height: 32,
      background: 'rgba(5,8,16,0.88)', backdropFilter: 'blur(12px)',
      border: '1px solid var(--border)', borderRadius: 7,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', color: 'var(--text2)', transition: 'all 0.2s',
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ width: 13, height: 13 }}>
        {children}
      </svg>
    </div>
  )
}
