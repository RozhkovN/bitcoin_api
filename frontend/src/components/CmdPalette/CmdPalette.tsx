import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store'
import styles from './CmdPalette.module.css'

interface CmdItem {
  title: string
  sub: string
  shortcut?: string
  action: () => void
  icon: string
}

interface Props {
  open: boolean
  onClose: () => void
  onAnalyze: (addr: string, chain: string) => void
}

export default function CmdPalette({ open, onClose, onAnalyze }: Props) {
  const { toggle3D, clearGraph, openTxSheet, toggleSettings, mergedGraph, addToast } = useStore()
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const buildItems = (): CmdItem[] => [
    { title: 'Анализировать адрес', sub: 'Введите адрес BTC или ETH', action: () => { onClose(); document.querySelector<HTMLInputElement>('[data-search-input]')?.focus() }, icon: 'search' },
    { title: 'Переключить 3D / 2D', sub: 'Переключить режим графа', shortcut: '3', action: () => { toggle3D(); onClose() }, icon: 'cube' },
    { title: 'Лента транзакций', sub: 'Показать все TX', shortcut: 'T', action: () => { openTxSheet(); onClose() }, icon: 'list' },
    { title: 'Настройки', sub: 'Открыть настройки', shortcut: '⌘,', action: () => { toggleSettings(); onClose() }, icon: 'settings' },
    { title: 'Экспорт JSON', sub: 'Скачать данные графа', action: () => {
      if (!mergedGraph) return
      const blob = new Blob([JSON.stringify(mergedGraph, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `forensics_${Date.now()}.json`; a.click()
      URL.revokeObjectURL(url)
      addToast('Экспорт готов', 'success')
      onClose()
    }, icon: 'download' },
    { title: 'Очистить граф', sub: 'Сбросить всё', action: () => { clearGraph(); onClose() }, icon: 'trash' },
    { title: 'Поделиться ссылкой', sub: 'Скопировать URL', action: () => {
      navigator.clipboard.writeText(location.href)
      addToast('Ссылка скопирована', 'success')
      onClose()
    }, icon: 'share' },
  ]

  const items = buildItems().filter(item =>
    !query || item.title.toLowerCase().includes(query.toLowerCase()) || item.sub.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter') { items[sel]?.action() }
  }

  const iconSvg = (icon: string) => {
    const paths: Record<string, string> = {
      search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
      cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
      list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
      share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    }
    return paths[icon] || ''
  }

  if (!open) return null

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.box}>
        <div className={styles.inputWrap}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Введите команду или адрес…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSel(0) }}
            onKeyDown={handleKey}
            autoComplete="off"
          />
          <span className={styles.esc}>ESC</span>
        </div>
        <div className={styles.results}>
          {items.map((item, i) => (
            <div key={i} className={`${styles.item} ${i === sel ? styles.itemSel : ''}`}
              onClick={item.action}
              onMouseEnter={() => setSel(i)}>
              <div className={styles.itemIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  dangerouslySetInnerHTML={{ __html: iconSvg(item.icon) }} />
              </div>
              <div className={styles.itemText}>
                <div className={styles.itemTitle}>{item.title}</div>
                <div className={styles.itemSub}>{item.sub}</div>
              </div>
              {item.shortcut && <span className={styles.shortcut}>{item.shortcut}</span>}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              Ничего не найдено
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
