import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'

export default function Legend() {
  const { mergedGraph } = useStore()
  const hasGraph = !!mergedGraph
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-show for 5s when graph first appears, then hide
  useEffect(() => {
    if (!hasGraph) { setVisible(false); return }
    setVisible(true)
    timerRef.current = setTimeout(() => setVisible(false), 5000)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [hasGraph])

  // Re-show on any mouse movement over the graph area (bottom half of screen)
  useEffect(() => {
    if (!hasGraph) return
    let lastShow = 0
    const onMove = (e: MouseEvent) => {
      if (e.clientY > window.innerHeight * 0.6) {
        const now = Date.now()
        if (now - lastShow > 2000) { // debounce — don't re-trigger constantly
          lastShow = now
          setVisible(true)
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => setVisible(false), 3500)
        }
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [hasGraph])

  if (!hasGraph) return null

  return (
    <div style={{
      position: 'absolute',
      bottom: 40,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      background: 'rgba(5,8,16,0.9)',
      backdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      padding: '7px 14px',
      zIndex: 10,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    }}>
      <Leg color="#3b82f6">Текущий кошелёк</Leg>
      <Sep />
      <Leg color="#06b6d4">Цепочка анализа</Leg>
      <Leg color="rgba(96,165,250,0.85)" type="line">Связь между ними</Leg>
      <Sep />
      <Leg color="#10b981">Контрагент · Низкий</Leg>
      <Leg color="#f59e0b">Средний</Leg>
      <Leg color="#f87171">Высокий риск</Leg>
      <Sep />
      <Leg color="rgba(16,185,129,0.5)" type="line">Деньги входят</Leg>
      <Leg color="rgba(248,113,113,0.5)" type="line">Деньги уходят</Leg>
    </div>
  )
}

function Leg({ color, children, type }: { color: string; children: string; type?: 'line' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
      {type === 'line'
        ? <div style={{ width: 16, height: 2, background: color, borderRadius: 99 }} />
        : <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      }
      {children}
    </div>
  )
}

function Sep() {
  return <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.08)' }} />
}
