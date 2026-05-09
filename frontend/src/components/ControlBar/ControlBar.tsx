import { useRef } from 'react'
import { useStore } from '../../store'
import { shortAddr } from '../../utils/format'
import styles from './ControlBar.module.css'

interface Props {
  onLoadMore: () => void
  onFocusNode: (addr: string) => void
  onAnalyze: (addr: string, chain: string) => void
  enriching: boolean
}

export default function ControlBar({ onLoadMore, onFocusNode, onAnalyze, enriching }: Props) {
  const {
    mergedGraph, txStep, setTxStep, maxNodes, setMaxNodes,
    multiMode, toggleMultiMode, walletTrail, currentAddr,
    clearGraph, openTxSheet, navBack, navForward, navHistory, navIdx,
    setDateFilter, dateFrom, dateTo, setViewAddr, viewAddr, setSelectedNode,
  } = useStore()

  const hasGraph = !!mergedGraph

  const handleDateChange = (from: string, to: string) => {
    setDateFilter(from, to)
  }

  const scrollRef = useRef<HTMLDivElement>(null)

  const trailGo = (addr: string, chain: string) => {
    const node = mergedGraph?.nodes?.find(n => n.fullAddress === addr || n.id === addr)
    if (node) {
      // Фокусируем камеру на узле
      onFocusNode(addr)
      // В мульти-режиме — переключаем левую панель на статистику этого кошелька
      if (multiMode) {
        setViewAddr(addr)
        // Открываем правую панель (детали узла) с небольшой задержкой
        setTimeout(() => setSelectedNode(node as any), 300)
      }
    } else {
      // Адреса нет в графе — полный повторный анализ
      onAnalyze(addr, chain === 'bitcoin' ? 'btc' : 'eth')
    }
  }

  return (
    <div className={`${styles.bar} ${hasGraph ? styles.show : ''}`}>
      {/* TX step */}
      <div className={styles.group} title="Шаг загрузки: сколько TX загрузить за один раз">
        <span className={styles.label}>Шаг TX:</span>
        <input
          type="range"
          className={styles.slider}
          min={50} max={2000} step={50}
          value={Math.min(txStep, 2000)}
          onChange={e => setTxStep(Number(e.target.value))}
        />
        <input
          type="number"
          className={styles.numInput}
          min={1} max={5000} step={50}
          value={txStep}
          onChange={e => setTxStep(Number(e.target.value) || 500)}
        />
      </div>

      <div className={styles.sep} />

      {/* Date filter */}
      <div className={styles.group}>
        <span className={styles.label}>С</span>
        <input type="date" className={styles.dateInput}
          value={dateFrom}
          onChange={e => handleDateChange(e.target.value, dateTo)} />
        <span className={styles.label}>По</span>
        <input type="date" className={styles.dateInput}
          value={dateTo}
          onChange={e => handleDateChange(dateFrom, e.target.value)} />
        <button className={styles.btn} onClick={() => handleDateChange('', '')} title="Сбросить">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className={styles.sep} />

      {/* Max nodes */}
      <div className={styles.group} title="Максимум узлов на графе">
        <span className={styles.label}>Узлов:</span>
        <input
          type="number"
          className={styles.numInput}
          style={{ width: 54 }}
          min={10} max={9999} step={50}
          value={maxNodes}
          onChange={e => setMaxNodes(Number(e.target.value) || 300)}
        />
      </div>

      <div className={styles.sep} />

      {/* TX Sheet button */}
      <button className={styles.btn} disabled={!hasGraph} onClick={openTxSheet} title="Лента транзакций">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
          <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
          <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Лента TX
      </button>

      <div className={styles.sep} />

      {/* Load more */}
      <button
        className={`${styles.btn} ${styles.accent}`}
        disabled={!hasGraph || enriching}
        onClick={onLoadMore}
      >
        {enriching
          ? <><svg viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Загружаю…</>
          : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg> Дозагрузить +{txStep}</>
        }
      </button>

      <div className={styles.sep} />

      {/* Multi-mode toggle */}
      <div className={`${styles.multiToggle} ${multiMode ? styles.on : ''}`} onClick={toggleMultiMode}
        title="Мульти-кошелёк: накапливать граф при анализе новых адресов">
        <div className={styles.dot} />
        <span>Мульти-режим</span>
      </div>

      <div className={styles.sep} />

      {/* Wallet trail */}
      <div className={styles.trail} ref={scrollRef}>
        {walletTrail.map((w, i) => (
          <div key={w.addr} className={styles.trailItem}>
            {i > 0 && <span className={styles.trailSep}>→</span>}
            <span
              className={`${styles.trailAddr} ${(multiMode ? (viewAddr || currentAddr) : currentAddr) === w.addr ? styles.active : ''}`}
              title={w.addr}
              onClick={() => trailGo(w.addr, w.chain)}
            >
              {shortAddr(w.addr)}
            </span>
          </div>
        ))}
      </div>

      {/* Clear button */}
      {hasGraph && (
        <>
          <div className={styles.sep} />
          <button className={styles.btn} onClick={clearGraph} style={{ marginLeft: 'auto' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Очистить
          </button>
        </>
      )}
    </div>
  )
}
