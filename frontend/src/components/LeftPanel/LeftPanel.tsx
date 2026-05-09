import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { fmt8, fmtCompact, fmtDate, fmtDateTime, riskColor, shortAddr } from '../../utils/format'
import styles from './LeftPanel.module.css'

export default function LeftPanel({ onNodeSelect }: { onNodeSelect?: (addr: string) => void }) {
  const { mergedGraph, currentAddr, currentChain, addToast, viewAddr, walletGraphs, multiMode } = useStore()

  // В мульти-режиме: если пользователь кликнул по кошельку в trail — показываем
  // его индивидуальный граф (walletGraphs[viewAddr]). Иначе — общий mergedGraph.
  const displayAddr = (multiMode && viewAddr && walletGraphs[viewAddr]) ? viewAddr : currentAddr
  const data = (multiMode && viewAddr && walletGraphs[viewAddr]) ? walletGraphs[viewAddr] : mergedGraph
  const visible = !!data

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(() => addToast('Скопировано', 'success', 1500))
  }

  const openExplorer = (addr: string, chain: string) => {
    const url = chain === 'ethereum'
      ? `https://etherscan.io/address/${addr}`
      : `https://mempool.space/address/${addr}`
    window.open(url, '_blank')
  }

  return (
    <aside className={`${styles.panel} ${visible ? styles.visible : ''}`}>
      {/* Risk Gauge */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Risk Score</div>
        <RiskGauge score={data?.riskScore || 0} level={data?.riskLevel || 'low'} />
        <RiskLegend />
      </div>

      {/* Address info */}
      {data && displayAddr && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Адрес</div>
          <div className={styles.addrCard}>
            <div className={styles.addrLabel}>
              {multiMode && viewAddr && viewAddr !== currentAddr ? 'Кошелёк цепочки' : 'Центральный кошелёк'}
            </div>
            <div className={styles.addrFull} onClick={() => copyText(displayAddr)} title="Нажмите чтобы скопировать">
              {displayAddr}
            </div>
            <div className={styles.addrActions}>
              <button className={styles.addrActBtn} onClick={() => copyText(displayAddr)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                Копировать
              </button>
              <button className={styles.addrActBtn} onClick={() => openExplorer(displayAddr, currentChain)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Explorer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Статистика</div>
        {data ? (
          <div className={styles.stats}>
            <StatRow label="Контрагентов" value={data.stats?.uniqueCounterparties || 0} />
            <StatRow label="Транзакций" value={data.stats?.analyzedTx || 0} />
            <StatRow label="Входящих TX" value={data.stats?.incomingTx || 0} cls="g" />
            <StatRow label="Исходящих TX" value={data.stats?.outgoingTx || 0} cls="r" />
            <StatRow
              label="Объём (in)"
              value={`${fmtCompact(data.stats?.inVolume || 0)} ${currentChain === 'ethereum' ? 'ETH' : 'BTC'}`}
              cls="g"
              title={`${fmt8(data.stats?.inVolume || 0)} ${currentChain === 'ethereum' ? 'ETH' : 'BTC'}`}
            />
            <StatRow
              label="Объём (out)"
              value={`${fmtCompact(data.stats?.outVolume || 0)} ${currentChain === 'ethereum' ? 'ETH' : 'BTC'}`}
              cls="r"
              title={`${fmt8(data.stats?.outVolume || 0)} ${currentChain === 'ethereum' ? 'ETH' : 'BTC'}`}
            />
            <StatRow label="Первая TX" value={fmtDate(data.stats?.firstActivity || 0)} />
            <StatRow label="Последняя TX" value={fmtDate(data.stats?.lastActivity || 0)} />
            <StatRow label="Узлов" value={(data.nodes || []).length} cls="b" />
            <StatRow label="Рёбер" value={(data.edges || []).length} />
          </div>
        ) : (
          <div className={styles.noData}>Нет данных</div>
        )}
      </div>

      {/* Activity chart */}
      {data && data.edges?.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Активность</div>
          <ActivityChart data={data} />
        </div>
      )}

      {/* Top counterparties */}
      {data && data.nodes?.length > 1 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Топ контрагенты</div>
          <TopCounterparties data={data} centerAddr={displayAddr} onSelect={onNodeSelect} />
        </div>
      )}

      {/* Risk factors */}
      {data && data.riskFactors?.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Факторы риска</div>
          <div>
            {data.riskFactors.map((f, i) => (
              <div key={i} className={styles.factorItem}>
                <div className={styles.factorHead}>
                  <span className={styles.factorName}>{f.name}</span>
                  <span className={styles.factorScore} style={{ color: riskColor(f.score) }}>{f.score}</span>
                </div>
                <div className={styles.factorDetail}>{f.detail}</div>
                <div className={styles.factorBarWrap}>
                  <div className={styles.factorBar} style={{ width: `${f.score}%`, background: riskColor(f.score) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

function StatRow({
  label, value, cls, title,
}: { label: string; value: string | number; cls?: string; title?: string }) {
  return (
    <div className={styles.statRow} title={title}>
      <span className={styles.statK}>{label}</span>
      <span className={`${styles.statV} ${cls ? styles[cls] : ''}`}>{value}</span>
    </div>
  )
}

function RiskGauge({ score, level }: { score: number; level: string }) {
  const color = riskColor(score)
  const arc = 213
  const offset = arc - (arc * score) / 100

  const levelMap: Record<string, string> = {
    low: 'НИЗКИЙ', medium: 'СРЕДНИЙ', high: 'ВЫСОКИЙ', critical: 'КРИТИЧЕСКИЙ'
  }

  return (
    <div className={styles.gaugeWrap}>
      <svg width="180" height="115" viewBox="0 0 180 115" overflow="visible">
        <path className={styles.gTrack} d="M22,100 A68,68 0 0,1 158,100"/>
        <path
          className={styles.gGlow}
          d="M22,100 A68,68 0 0,1 158,100"
          stroke={color}
          strokeDasharray={arc}
          strokeDashoffset={offset}
        />
        <path
          className={styles.gFill}
          d="M22,100 A68,68 0 0,1 158,100"
          stroke={color}
          strokeDasharray={arc}
          strokeDashoffset={offset}
        />
        <text className={styles.gScore} x="90" y="88">{score > 0 ? score : '—'}</text>
        <text className={styles.gLevel} x="90" y="107">{levelMap[level] || 'ОЖИДАНИЕ'}</text>
      </svg>
      {score > 0 && (
        <div className={`${styles.riskPill} ${styles[level]}`}>
          {levelMap[level] || level}
        </div>
      )}
    </div>
  )
}

function ActivityChart({ data }: { data: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const edges = data.edges || []
    if (!edges.length) return

    const ts = edges
      .map((e: any) => e.timestamp)
      .filter(Boolean)
      .sort((a: number, b: number) => a - b)

    if (!ts.length) return

    const min = ts[0]
    const max = ts[ts.length - 1]
    const range = max - min || 1
    const buckets = 24
    const counts = new Array(buckets).fill(0)

    ts.forEach((t: number) => {
      const idx = Math.min(buckets - 1, Math.floor(((t - min) / range) * buckets))
      counts[idx]++
    })

    const W = canvas.width = canvas.offsetWidth * window.devicePixelRatio
    const H = canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.clearRect(0, 0, W, H)

    const maxC = Math.max(...counts, 1)
    const bw = W / buckets

    counts.forEach((c, i) => {
      const h = (c / maxC) * (H * 0.75)
      const x = i * bw
      const grad = ctx.createLinearGradient(0, H - h, 0, H)
      grad.addColorStop(0, 'rgba(59,130,246,0.6)')
      grad.addColorStop(1, 'rgba(6,182,212,0.1)')
      ctx.fillStyle = grad
      ctx.fillRect(x + 1, H - h, bw - 2, h)
    })
  }, [data])

  return (
    <div className={styles.chartWrap}>
      <canvas ref={canvasRef} className={styles.chartCanvas} />
    </div>
  )
}

function TopCounterparties({ data, centerAddr, onSelect }: { data: any; centerAddr: string | null; onSelect?: (addr: string) => void }) {
  // Сортируем по количеству TX с этим контрагентом (не по объёму)
  const nodes = (data.nodes || [])
    .filter((n: any) => !n.isCenter)
    .sort((a: any, b: any) => (b.txCount || 0) - (a.txCount || 0))
    .slice(0, 5)

  const maxTx = Math.max(...nodes.map((n: any) => n.txCount || 0), 1)

  return (
    <div>
      {nodes.map((n: any) => {
        const vol = (n.totalIn || 0) + (n.totalOut || 0)
        const pct = ((n.txCount || 0) / maxTx) * 100
        const isIn = (n.totalIn || 0) >= (n.totalOut || 0)
        return (
          <div key={n.id} className={styles.cpItem}>
            <div className={styles.cpHeader}>
              <span className={styles.cpAddr} onClick={() => onSelect?.(n.fullAddress || n.id)}>
                {shortAddr(n.fullAddress || n.id)}
              </span>
              <span className={styles.cpVal} title={`Объём: ${fmt8(vol)}`}>
                {n.txCount || 0} TX
              </span>
            </div>
            <div className={styles.cpBarWrap}>
              <div className={`${styles.cpBar} ${isIn ? styles.cpIn : styles.cpOut}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Легенда риск-скора ────────────────────────────────────────────────────────
function RiskLegend() {
  const levels = [
    { range: '0 – 14',  label: 'Низкий',      color: '#10b981', desc: 'Редкие транзакции, небольшой объём. Стандартный кошелёк.' },
    { range: '15 – 44', label: 'Средний',     color: '#f59e0b', desc: 'Заметный объём или частота. Требует внимания.' },
    { range: '45 – 69', label: 'Высокий',     color: '#f97316', desc: 'Высокий объём, большая частота или транзитный паттерн.' },
    { range: '70 – 100',label: 'Критический', color: '#ef4444', desc: 'Миксер, dust-атака или крупный подозрительный оборот.' },
  ]

  const badges = [
    { badge: 'MIXER',    color: '#92400e', bg: '#fef3c7', desc: 'Идеальный баланс in/out + высокая частота — признак миксера.' },
    { badge: 'TRANSIT',  color: '#075985', bg: '#e0f2fe', desc: 'Баланс входящих и исходящих близок к 1:1 — транзитный кошелёк.' },
    { badge: 'DUST',     color: '#831843', bg: '#fce7f3', desc: 'Множество мелких (< 0.001) транзакций — dust attack.' },
    { badge: 'HIGH-VOL', color: '#713f12', bg: '#fef9c3', desc: 'Очень крупный оборот при малом числе TX.' },
    { badge: 'FREQUENT', color: '#14532d', bg: '#dcfce7', desc: 'Много транзакций с одним контрагентом.' },
  ]

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontWeight: 600 }}>
        Шкала риска
      </div>
      {levels.map(l => (
        <div key={l.range} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color, flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: l.color }}>
              {l.label} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{l.range}</span>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text3)', lineHeight: 1.4 }}>{l.desc}</div>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '10px 0 8px', fontWeight: 600 }}>
        Метки узлов
      </div>
      {badges.map(b => (
        <div key={b.badge} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
          <span style={{
            display: 'inline-block', padding: '1px 6px', borderRadius: 4,
            background: b.bg + 'cc', color: b.color,
            fontSize: 8, fontWeight: 700, flexShrink: 0, marginTop: 1,
          }}>{b.badge}</span>
          <div style={{ fontSize: 9.5, color: 'var(--text3)', lineHeight: 1.4 }}>{b.desc}</div>
        </div>
      ))}
    </div>
  )
}
