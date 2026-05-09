import { useStore } from '../../store'

export default function StatusBar() {
  const { mergedGraph, currentAddr, currentChain } = useStore()
  const visible = !!mergedGraph

  const nodeCount = mergedGraph?.nodes?.length || 0
  const edgeCount = mergedGraph?.edges?.length || 0
  const txCount = mergedGraph?.stats?.analyzedTx || 0
  const chain = currentChain === 'ethereum' ? 'ETH' : 'BTC'

  return (
    <div id="statusbar" style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: 26,
      background: 'rgba(5,8,16,0.9)',
      backdropFilter: 'blur(12px)',
      borderTop: '1px solid var(--border)',
      zIndex: 50,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 20,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.4s',
      fontSize: 10.5,
    }}>
      <SbItem dot="#3b82f6" label="Узлов" value={nodeCount} />
      <SbItem dot="#94a3b8" label="Рёбер" value={edgeCount} />
      <SbItem dot="#10b981" label="TX" value={txCount} />
      {currentAddr && <SbItem dot="#f59e0b" label="Адрес" value={currentAddr.slice(0, 10) + '…'} />}
      <div style={{ marginLeft: 'auto', color: 'var(--text4)', fontSize: 10 }}>{chain} · cache+relay</div>
    </div>
  )
}

function SbItem({ dot, label, value }: { dot: string; label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text3)' }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: dot }} />
      {label}: <span style={{ color: 'var(--text2)', fontFamily: 'var(--mono)' }}>{value}</span>
    </div>
  )
}
