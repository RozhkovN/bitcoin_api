import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { fmt8, fmtCompact, fmtDate, riskColor, riskLabel } from '../../utils/format'
import type { GraphNode } from '../../types'
import styles from './NodeDetails.module.css'

interface Props {
  node: GraphNode | null
  onClose: () => void
  onExplore: (addr: string, chain: string) => void
  graphEdges: any[]
}

const EDGES_PAGE = 30

export default function NodeDetails({ node, onClose, onExplore, graphEdges }: Props) {
  const { addToast, currentChain, openTxDetail } = useStore()
  const [shown, setShown] = useState(EDGES_PAGE)

  // Reset pagination whenever the selected node changes.
  useEffect(() => { setShown(EDGES_PAGE) }, [node?.id])

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(() => addToast('Скопировано', 'success', 1500))
  }

  const openExplorer = (addr: string) => {
    const url = currentChain === 'ethereum'
      ? `https://etherscan.io/address/${addr}`
      : `https://mempool.space/address/${addr}`
    window.open(url, '_blank')
  }

  // Edges connected to this node — sorted newest first.
  const allEdges = useMemo(() => {
    if (!node) return [] as any[]
    return graphEdges
      .filter(e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source
        const tid = typeof e.target === 'object' ? e.target.id : e.target
        return sid === node.id || tid === node.id
      })
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  }, [node, graphEdges])

  const edges = allEdges.slice(0, shown)
  const remaining = allEdges.length - edges.length
  const unit = currentChain === 'ethereum' ? 'ETH' : 'BTC'

  return (
    <div className={`${styles.panel} ${node ? styles.open : ''}`}>
      <div className={styles.header}>
        <span className={styles.title}>Узел</span>
        <div className={styles.closeBtn} onClick={onClose}>✕</div>
      </div>

      {node && (
        <div className={styles.body}>
          {/* Address card */}
          <div className={styles.addrCard}>
            <div className={styles.addrLabel}>Адрес</div>
            <div className={styles.addrFull} onClick={() => copyText(node.fullAddress || node.id)}>
              {node.fullAddress || node.id}
            </div>
            <div className={styles.addrActions}>
              <button className={styles.addrActBtn} onClick={() => copyText(node.fullAddress || node.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Копировать
              </button>
              <button className={styles.addrActBtn} onClick={() => openExplorer(node.fullAddress || node.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Explorer
              </button>
            </div>
          </div>

          {/* Node type + risk */}
          <div className={styles.nodeMeta}>
            <span className={`${styles.typeBadge} ${node.isCenter ? styles.center : styles.counterparty}`}>
              {node.isCenter ? '● Центр' : node.isAnalyzed ? '◉ Анализирован' : '○ Контрагент'}
            </span>
            <span className={styles.riskBadge} style={{ color: riskColor(node.riskScore || 0) }}>
              {riskLabel(node.riskLevel || 'low')} · {node.riskScore || 0}
            </span>
          </div>

          {/* Stat grid */}
          <div className={styles.statGrid}>
            <StatCard label="TX" value={node.txCount || 0} />
            <StatCard label="Риск" value={node.riskScore || 0} color={riskColor(node.riskScore || 0)} />
            <StatCard
              label={`Входящих ${unit}`}
              value={fmtCompact(node.totalIn || 0)}
              cls="g"
              title={`${fmt8(node.totalIn || 0)} ${unit}`}
            />
            <StatCard
              label={`Исходящих ${unit}`}
              value={fmtCompact(node.totalOut || 0)}
              cls="r"
              title={`${fmt8(node.totalOut || 0)} ${unit}`}
            />
          </div>

          <div className={styles.statRow}>
            <span className={styles.statK}>Net flow</span>
            <span
              className={styles.statV}
              style={{ color: (node.netFlow || 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}
              title={`${fmt8(node.netFlow || 0)} ${unit}`}
            >
              {(node.netFlow || 0) >= 0 ? '+' : '−'}{fmtCompact(Math.abs(node.netFlow || 0))} {unit}
            </span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statK}>Первая TX</span>
            <span className={styles.statV}>{fmtDate(node.firstSeen)}</span>
          </div>
          <div className={styles.statRow}>
            <span className={styles.statK}>Последняя TX</span>
            <span className={styles.statV}>{fmtDate(node.lastSeen)}</span>
          </div>

          {/* Edges */}
          {allEdges.length > 0 && (
            <>
              <div className={styles.edgesTitle}>
                Транзакции ({allEdges.length})
              </div>
              {edges.map((e, i) => {
                const sid = typeof e.source === 'object' ? e.source.id : e.source
                const isOut = sid === node.id
                return (
                  <div key={`${e.id || ''}-${i}`} className={styles.edgeItem}
                    onClick={() => openTxDetail(
                      e.hash,
                      e.direction || '',
                      isOut
                        ? (typeof e.target === 'object' ? e.target.id : e.target)
                        : sid,
                      e.value || 0,
                    )}
                    style={{ cursor: e.hash ? 'pointer' : 'default' }}>
                    <div className={`${styles.edgeDir} ${isOut ? styles.edgeOut : styles.edgeIn}`}>
                      {isOut ? '↑ Исходящая' : '↓ Входящая'}
                    </div>
                    <div className={styles.edgeDetails} title={`${fmt8(e.value || 0)} ${unit}`}>
                      {fmtCompact(e.value || 0)} {unit} · {fmtDate(e.timestamp)} · TX {e.txCount || 1}
                    </div>
                  </div>
                )
              })}
              {remaining > 0 && (
                <button
                  className={styles.exploreBtn}
                  style={{ marginTop: 6 }}
                  onClick={() => setShown(s => s + EDGES_PAGE)}
                >
                  Показать ещё {Math.min(remaining, EDGES_PAGE)}
                </button>
              )}
            </>
          )}

          {/* Explore button */}
          {!node.isCenter && (
            <button className={styles.exploreBtn} onClick={() => onExplore(node.fullAddress || node.id, currentChain)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Анализировать адрес
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label, value, cls, color, title,
}: { label: string; value: string | number; cls?: string; color?: string; title?: string }) {
  return (
    <div className={styles.nsgCard} title={title}>
      <div className={styles.nsgLabel}>{label}</div>
      <div className={`${styles.nsgVal} ${cls ? styles[cls] : ''}`} style={color ? { color } : {}}>
        {value}
      </div>
    </div>
  )
}
