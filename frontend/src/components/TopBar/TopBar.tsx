import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store'
import { detectChain } from '../../utils/format'
import { clearSession } from '../../hooks/useSession'
import styles from './TopBar.module.css'

interface Props {
  onAnalyze: (addr: string, chain: string) => void
  onOpenCmd: () => void
}

interface HistoryItem { addr: string; chain: string; ts: number }

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return 'только что'
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`
  return `${Math.floor(diff / 86400)}д назад`
}

export default function TopBar({ onAnalyze, onOpenCmd }: Props) {
  const { is3D, toggle3D, navBack, navForward, navHistory, navIdx, toggleSettings, mergedGraph, addToast, currentAddr, clearGraph } = useStore()
  const navigate = useNavigate()
  const [addr, setAddr] = useState('')
  const [chain, setChain] = useState('auto')
  const [showHist, setShowHist] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem('bf_history') || '[]')) } catch {}
  }, [])

  // Sync addr input when currentAddr changes (from history navigation)
  useEffect(() => {
    if (currentAddr) setAddr(currentAddr)
  }, [currentAddr])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!addr.trim()) return
    onAnalyze(addr.trim(), chain)
    setShowHist(false)
  }

  const handleHistorySelect = (item: HistoryItem) => {
    setAddr(item.addr)
    setChain(item.chain === 'bitcoin' ? 'btc' : item.chain === 'ethereum' ? 'eth' : 'auto')
    setShowHist(false)
    onAnalyze(item.addr, item.chain === 'bitcoin' ? 'btc' : 'eth')
  }

  const delHistory = (e: React.MouseEvent, addr: string) => {
    e.stopPropagation()
    const filtered = history.filter(h => h.addr !== addr)
    setHistory(filtered)
    try { localStorage.setItem('bf_history', JSON.stringify(filtered)) } catch {}
  }

  const filteredHist = history.filter(h =>
    !addr || h.addr.toLowerCase().includes(addr.toLowerCase())
  )

  const exportReport = () => {
    if (!mergedGraph) return
    const blob = new Blob([JSON.stringify(mergedGraph, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `forensics_${currentAddr?.slice(0, 8)}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    addToast('Экспорт готов', 'success')
  }

  const shareLink = () => {
    if (!currentAddr) return
    const url = `${location.origin}${location.pathname}?addr=${encodeURIComponent(currentAddr)}&chain=${chain}`
    navigator.clipboard.writeText(url).then(() => addToast('Ссылка скопирована', 'success'))
  }

  const canBack = navIdx > 0
  const canFwd = navIdx < navHistory.length - 1

  return (
    <header className={styles.topbar}>
      <a className={styles.brand} href="/">
        <div className={styles.brandIcon}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="M9 12l2 2 4-4"/>
          </svg>
        </div>
        <div className={styles.brandText}>
          <span className={styles.brandName}>Blockchain Forensics</span>
          <span className={styles.brandSub}>Threat Intelligence</span>
        </div>
      </a>

      <div className={styles.searchWrap}>
        <form className={styles.searchForm} onSubmit={handleSubmit}>
          <select className={styles.chainSelect} value={chain} onChange={e => setChain(e.target.value)}>
            <option value="auto">Auto</option>
            <option value="btc">Bitcoin</option>
            <option value="eth">Ethereum</option>
          </select>
          <input
            ref={inputRef}
            className={styles.addrInput}
            type="text"
            value={addr}
            placeholder="Адрес BTC или ETH…"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setAddr(e.target.value)}
            onFocus={() => setShowHist(true)}
            onBlur={() => setTimeout(() => setShowHist(false), 200)}
          />
          <button className={styles.analyzeBtn} type="submit">Анализировать</button>
        </form>

        {showHist && filteredHist.length > 0 && (
          <div className={styles.histDrop}>
            <div className={styles.histHeader}>Последние адреса</div>
            {filteredHist.slice(0, 10).map(item => (
              <div key={item.addr} className={styles.histItem} onClick={() => handleHistorySelect(item)}>
                <span className={`${styles.histChain} ${item.chain === 'bitcoin' ? styles.btc : item.chain === 'ethereum' ? styles.eth : styles.unk}`}>
                  {item.chain === 'bitcoin' ? 'BTC' : item.chain === 'ethereum' ? 'ETH' : '?'}
                </span>
                <span className={styles.histAddr}>{item.addr}</span>
                <span className={styles.histTime}>{timeAgo(item.ts)}</span>
                <span className={styles.histDel} onClick={e => delHistory(e, item.addr)}>✕</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Nav history */}
      <div className={styles.navBtns}>
        <button className={styles.navBtn} onClick={navBack} disabled={!canBack} title="Назад (Alt+←)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button className={styles.navBtn} onClick={navForward} disabled={!canFwd} title="Вперёд (Alt+→)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        {navHistory.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text4)', minWidth: 24, textAlign: 'center' }}>
            {navIdx + 1}/{navHistory.length}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        <div className={styles.iconBtn} onClick={toggle3D} data-tip="3D / 2D">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {is3D
              ? <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>
              : <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></>
            }
          </svg>
        </div>
        <div className={styles.iconBtn} onClick={exportReport} data-tip="Экспорт JSON">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div className={styles.iconBtn} onClick={shareLink} data-tip="Поделиться">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </div>
        <div className={styles.iconBtn} onClick={() => navigate('/trace')} data-tip="Trace · Движение средств">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <div className={styles.iconBtn} onClick={toggleSettings} data-tip="Настройки ⌘,">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <div className={styles.sep} />
        <div className={styles.iconBtn} onClick={onOpenCmd} data-tip="Команды ⌘K">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/>
            <line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </div>
        <a
          className={styles.iconBtn}
          href="/"
          data-tip="На главную"
          onClick={(e) => {
            // Кнопка-домой — единственный путь, который сбрасывает локальную сессию.
            // Все остальные навигации (refresh, history) сохраняют анализ.
            e.preventDefault()
            clearSession()
            clearGraph()
            window.location.href = '/'
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </a>
      </div>
    </header>
  )
}
