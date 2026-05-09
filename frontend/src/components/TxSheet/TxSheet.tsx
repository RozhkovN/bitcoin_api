import { useState, useMemo, useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { shortAddr, fmt8, fmtDate } from '../../utils/format'
import { riskColor } from '../../utils/format'
import type { TxRow } from '../../types'
import styles from './TxSheet.module.css'

function buildTxRows(mergedGraph: any, currentAddr: string | null): TxRow[] {
  if (!mergedGraph || !currentAddr) return []
  const rows: TxRow[] = []
  const centerNode = (mergedGraph.nodes || []).find((n: any) => n.isCenter)

  ;(mergedGraph.edges || []).forEach((e: any) => {
    const sid = typeof e.source === 'object' ? e.source.id : e.source
    const tid = typeof e.target === 'object' ? e.target.id : e.target
    const sNode = (mergedGraph.nodes || []).find((n: any) => n.id === sid)
    const tNode = (mergedGraph.nodes || []).find((n: any) => n.id === tid)

    const dir = e.direction || (sid === currentAddr ? 'out' : 'in')
    const counterAddr = dir === 'out' ? (tNode?.fullAddress || tid) : (sNode?.fullAddress || sid)
    const label = dir === 'out' ? (tNode?.label || shortAddr(tid)) : (sNode?.label || shortAddr(sid))

    rows.push({
      dir,
      fullAddr: counterAddr,
      label,
      amount: e.value || 0,
      txCount: e.txCount || 1,
      timestamp: e.timestamp || 0,
      date: e.date || '',
      hash: e.hash || '',
      riskScore: dir === 'out' ? (tNode?.riskScore || 0) : (sNode?.riskScore || 0),
      isAnalyzed: dir === 'out' ? (tNode?.isAnalyzed || false) : (sNode?.isAnalyzed || false),
    })
  })

  return rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

export default function TxSheet() {
  const {
    txSheetOpen, closeTxSheet,
    txSheetFilter, setTxSheetFilter,
    txSheetSearch, setTxSheetSearch,
    txSheetSort, setTxSheetSort,
    mergedGraph, currentAddr, currentChain,
    openTxDetail,
  } = useStore()

  const sheetRef = useRef<HTMLDivElement>(null)

  const allRows = useMemo(() => buildTxRows(mergedGraph, currentAddr), [mergedGraph, currentAddr])

  const filtered = useMemo(() => {
    let rows = allRows
    if (txSheetFilter) rows = rows.filter(r => r.dir === txSheetFilter)
    if (txSheetSearch) {
      const q = txSheetSearch.toLowerCase()
      rows = rows.filter(r => r.fullAddr.toLowerCase().includes(q) || r.hash.toLowerCase().includes(q))
    }
    switch (txSheetSort) {
      case 'date-asc': rows = [...rows].sort((a, b) => a.timestamp - b.timestamp); break
      case 'amount-desc': rows = [...rows].sort((a, b) => b.amount - a.amount); break
      case 'amount-asc': rows = [...rows].sort((a, b) => a.amount - b.amount); break
      case 'risk-desc': rows = [...rows].sort((a, b) => b.riskScore - a.riskScore); break
      default: rows = [...rows].sort((a, b) => b.timestamp - a.timestamp)
    }
    return rows
  }, [allRows, txSheetFilter, txSheetSearch, txSheetSort])

  const unit = currentChain === 'ethereum' ? 'ETH' : 'BTC'

  // Animate in/out
  useEffect(() => {
    if (!sheetRef.current) return
    if (txSheetOpen) {
      sheetRef.current.style.transform = 'translateY(100%)'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (sheetRef.current) sheetRef.current.style.transform = 'translateY(0)'
      }))
    }
  }, [txSheetOpen])

  if (!txSheetOpen) return null

  return (
    <>
      <div className={styles.overlay} onClick={closeTxSheet} />
      <div ref={sheetRef} className={styles.sheet} style={{ transform: 'translateY(100%)' }}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.title}>Лента транзакций</span>
            <span className={styles.count}>{filtered.length} из {allRows.length}</span>
          </div>
          <div className={styles.filters}>
            {(['', 'in', 'out'] as const).map(f => (
              <button key={f} className={`${styles.flt} ${txSheetFilter === f ? styles.fltActive : ''}`}
                onClick={() => setTxSheetFilter(f)} data-dir={f}>
                {f === '' ? 'Все' : f === 'in' ? '↓ Вход' : '↑ Выход'}
              </button>
            ))}
          </div>
          <input
            type="text"
            className={styles.search}
            placeholder="Поиск адреса или хэша…"
            value={txSheetSearch}
            onChange={e => setTxSheetSearch(e.target.value)}
          />
          <select className={styles.sortSelect} value={txSheetSort} onChange={e => setTxSheetSort(e.target.value)}>
            <option value="date-desc">Сначала новые</option>
            <option value="date-asc">Сначала старые</option>
            <option value="amount-desc">Сумма ↓</option>
            <option value="amount-asc">Сумма ↑</option>
            <option value="risk-desc">Риск ↓</option>
          </select>
          <button className={styles.closeBtn} onClick={closeTxSheet}>✕</button>
        </div>

        {/* Table header */}
        <div className={styles.tableHead}>
          <span style={{ width: 28 }} />
          <span style={{ flex: 1 }}>Адрес</span>
          <span style={{ width: 80, textAlign: 'right' }}>Риск</span>
          <span style={{ width: 100, textAlign: 'right' }}>Сумма</span>
          <span style={{ width: 100, textAlign: 'right' }}>Дата</span>
        </div>

        {/* Rows */}
        <div className={styles.body}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>Нет транзакций</div>
          ) : filtered.map((row, i) => (
            <div key={i} className={styles.row}
              onClick={() => row.hash && openTxDetail(row.hash, row.dir, row.fullAddr, row.amount)}>
              <div className={`${styles.dirIcon} ${row.dir === 'in' ? styles.dirIn : styles.dirOut}`}>
                {row.dir === 'in' ? '↓' : '↑'}
              </div>
              <div className={styles.addrWrap}>
                <div className={styles.addr}>{shortAddr(row.fullAddr)}</div>
                <div className={styles.addrSub}>{row.fullAddr}</div>
              </div>
              <div className={styles.risk} style={{ color: riskColor(row.riskScore) }}>
                {row.riskScore > 0 ? row.riskScore : '—'}
              </div>
              <div className={`${styles.amount} ${row.dir === 'in' ? styles.amtIn : styles.amtOut}`}>
                {row.dir === 'in' ? '+' : '-'}{fmt8(row.amount)} {unit}
              </div>
              <div className={styles.date}>{fmtDate(row.timestamp)}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
