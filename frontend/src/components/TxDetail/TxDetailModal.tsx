import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { fetchTxDetail } from '../../api'
import { fmt8, fmtDateTime, shortAddr } from '../../utils/format'
import type { MempoolTx } from '../../types'
import styles from './TxDetailModal.module.css'

export default function TxDetailModal() {
  const { txDetailOpen, txDetailHash, txDetailDir, txDetailCounterparty, txDetailAmount, closeTxDetail, addToast, currentChain } = useStore()
  const [tx, setTx] = useState<MempoolTx | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!txDetailOpen || !txDetailHash) { setTx(null); return }
    if (currentChain !== 'bitcoin') return // Only BTC detail from mempool.space
    setLoading(true)
    fetchTxDetail(txDetailHash)
      .then(setTx)
      .catch(err => addToast('Ошибка загрузки TX: ' + err.message, 'error'))
      .finally(() => setLoading(false))
  }, [txDetailOpen, txDetailHash])

  if (!txDetailOpen) return null

  const totalIn = tx?.vin?.reduce((s, v) => s + (v.prevout?.value || 0), 0) || 0
  const totalOut = tx?.vout?.reduce((s, v) => s + v.value, 0) || 0
  const fee = tx?.fee || (totalIn - totalOut)

  return (
    <>
      <div className={styles.overlay} onClick={closeTxDetail} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Детали транзакции</span>
          <button className={styles.closeBtn} onClick={closeTxDetail}>✕</button>
        </div>
        <div className={styles.body} id="txd-body">
          <div className={styles.hash}>{txDetailHash}</div>

          {loading && <div className={styles.loading}>Загрузка…</div>}

          {tx && (
            <>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Статус</span>
                <span className={styles.metaV} style={{ color: tx.status?.confirmed ? 'var(--success)' : 'var(--warn)' }}>
                  {tx.status?.confirmed ? `✓ Подтверждена (блок ${tx.status.block_height})` : '⏳ Ожидает'}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Время</span>
                <span className={styles.metaV}>{fmtDateTime(tx.status?.block_time || 0)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Размер</span>
                <span className={styles.metaV}>{tx.size} bytes / {tx.weight} wu</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Комиссия</span>
                <span className={styles.metaV}>{fmt8(fee / 1e8)} BTC ({tx.fee || 0} sat)</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Входов</span>
                <span className={styles.metaV}>{tx.vin?.length || 0}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Выходов</span>
                <span className={styles.metaV}>{tx.vout?.length || 0}</span>
              </div>

              {tx.vin?.length > 0 && (
                <>
                  <div className={styles.sectionTitle}>Входы (inputs)</div>
                  {tx.vin.map((v, i) => (
                    <div key={i} className={styles.ioRow}>
                      {v.is_coinbase
                        ? <span className={styles.ioAddr} style={{ color: '#f59e0b' }}>🪙 Coinbase</span>
                        : <span className={styles.ioAddr}
                            onClick={() => v.prevout?.scriptpubkey_address && navigator.clipboard.writeText(v.prevout.scriptpubkey_address).then(() => addToast('Скопировано', 'success', 1500))}>
                            {shortAddr(v.prevout?.scriptpubkey_address || v.txid || '')}
                          </span>
                      }
                      {v.prevout?.value != null && (
                        <span className={`${styles.ioVal} ${styles.ioOut}`}>{fmt8(v.prevout.value / 1e8)}</span>
                      )}
                    </div>
                  ))}
                </>
              )}

              {tx.vout?.length > 0 && (
                <>
                  <div className={styles.sectionTitle}>Выходы (outputs)</div>
                  {tx.vout.map((v, i) => (
                    <div key={i} className={styles.ioRow}>
                      <span className={styles.ioAddr}
                        onClick={() => v.scriptpubkey_address && navigator.clipboard.writeText(v.scriptpubkey_address).then(() => addToast('Скопировано', 'success', 1500))}>
                        {shortAddr(v.scriptpubkey_address || 'OP_RETURN')}
                      </span>
                      <span className={`${styles.ioVal} ${styles.ioIn}`}>{fmt8(v.value / 1e8)}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {!loading && !tx && txDetailHash && (
            <>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Направление</span>
                <span className={styles.metaV} style={{ color: txDetailDir === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                  {txDetailDir === 'in' ? '↓ Входящая' : '↑ Исходящая'}
                </span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Контрагент</span>
                <span className={styles.metaV}>{shortAddr(txDetailCounterparty)}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.metaK}>Сумма</span>
                <span className={styles.metaV}>{fmt8(txDetailAmount)}</span>
              </div>
            </>
          )}

          {txDetailHash && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {currentChain !== 'ethereum' && (
                <a
                  href={`/trace?hash=${encodeURIComponent(txDetailHash)}`}
                  className={styles.explorerLink}
                  style={{ flex: 1, justifyContent: 'center', background: 'rgba(16,185,129,0.12)', borderColor: 'rgba(16,185,129,0.3)', color: '#34d399' } as any}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Trace · движение средств
                </a>
              )}
              <a
                href={currentChain === 'ethereum'
                  ? `https://etherscan.io/tx/${txDetailHash}`
                  : `https://mempool.space/tx/${txDetailHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.explorerLink}
                style={{ flex: 1, justifyContent: 'center' } as any}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                Explorer
              </a>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
