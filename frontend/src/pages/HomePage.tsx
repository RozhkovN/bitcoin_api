import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SummaryCard { title: string; value: string }

interface BtcSummary {
  nTx: number; balance: number; totalReceived: number; totalSent: number; nUnredeemed: number
}
interface EthSummary {
  nTx: number; balance: number; totalReceived: number; totalSent: number; nUnredeemed: number
}

interface BtcTx {
  hash: string; date: string; direction: string; amount: number; fee: number
  size: number; weight: number; blockHeight: number; status: string; explorerUrl: string
  version: number; lockTime: number; vinSz: number; voutSz: number
  doubleSpend: boolean; relayedBy: string; totalInValue: number; totalOutValue: number
  from: string; to: string
  inputs: Array<{ addr: string; value: number }>
  outputs: Array<{ addr: string; value: number }>
}
interface EthTx {
  hash: string; date: string; direction: string; amount: number; fee: number
  gasUsed: number; gas: number; blockNumber: number; status: string; explorerUrl: string
  nonce: number; confirmations: number; transactionIndex: number
  from: string; to: string; input: string; methodId: string; functionName: string
}
type AnyTx = BtcTx | EthTx

interface AnalyzeResult {
  address: string; balance: number; totalOnChain: number
  requestedFetch: number; fetched: number; afterFilters: number
  incomingTx: number; outgoingTx: number; skippedNeutral: number
  totalIn: number; totalOut: number; netFlow: number
  transactions: AnyTx[]; warnings: string[]
}

type Chain = 'BTC' | 'ETH' | null

// ─── Helpers ──────────────────────────────────────────────────────────────────
const BTC_RE = /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/i
const ETH_RE = /^0x[a-fA-F0-9]{40}$/

function detectChain(addr: string): Chain {
  const a = addr.trim()
  if (BTC_RE.test(a)) return 'BTC'
  if (ETH_RE.test(a)) return 'ETH'
  return null
}

function shortAddr(addr: string) {
  if (!addr || addr.length < 14) return addr || '—'
  return `${addr.slice(0, 10)}…${addr.slice(-8)}`
}

function shortHash(v: string, max = 40) {
  if (!v) return '—'
  return v.length > max ? `${v.slice(0, max)}…` : v
}

function fmtNum(v: number | undefined | null, decimals = 8) {
  const n = Number(v || 0)
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: decimals }).format(n)
}

function fmtInt(v: number | undefined | null) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(v || 0))
}

function toLocalDate(v: string) {
  const d = new Date(v)
  if (isNaN(d.getTime())) return v || '—'
  return d.toLocaleString('ru-RU')
}

function safeUrl(v: string) {
  try {
    const u = new URL(String(v))
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.href.replace(/"/g, '%22')
  } catch { return '' }
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { signal: ctrl.signal }) }
  finally { clearTimeout(timer) }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HexCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let animId: number
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight }
    resize()
    window.addEventListener('resize', resize)

    const size = 28
    const hexes: Array<{ x: number; y: number; opacity: number; speed: number }> = []
    const populate = () => {
      hexes.length = 0
      const cols = Math.ceil(canvas.width / (size * 1.75)) + 2
      const rows = Math.ceil(canvas.height / (size * 1.5)) + 2
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
          hexes.push({ x: c * size * 1.75 + (r % 2 ? size * 0.875 : 0), y: r * size * 1.5, opacity: Math.random() * 0.04, speed: (Math.random() * 0.3 + 0.05) * (Math.random() < 0.5 ? 1 : -1) })
    }
    populate()

    function drawHex(x: number, y: number, s: number) {
      ctx!.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6
        const m = i === 0 ? 'moveTo' : 'lineTo'
        ctx![m](x + s * Math.cos(a), y + s * Math.sin(a))
      }
      ctx!.closePath()
    }

    function tick() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
      hexes.forEach(h => {
        h.opacity += h.speed * 0.004
        if (h.opacity > 0.06) h.speed = -Math.abs(h.speed)
        if (h.opacity < 0.005) h.speed = Math.abs(h.speed)
        ctx!.strokeStyle = `rgba(59,130,246,${h.opacity})`
        ctx!.lineWidth = 0.6
        drawHex(h.x, h.y, size)
        ctx!.stroke()
      })
      animId = requestAnimationFrame(tick)
    }
    tick()
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(animId) }
  }, [])
  return <canvas ref={ref} style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
}

function MetricCard({ title, value, delay = 0 }: { title: string; value: string; delay?: number }) {
  // Shrink font if value is long to prevent overflow
  const fontSize = value.length > 18 ? 14 : value.length > 12 ? 17 : 20
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6,
      animation: `fadeIn .4s ${delay}ms both`, transition: 'border-color .2s', minWidth: 0,
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(59,130,246,0.3)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    >
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
      <div style={{ fontSize, fontWeight: 700, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word', lineHeight: 1.3 }}>{value}</div>
    </div>
  )
}

interface IoSectionProps {
  title: string
  items: Array<{ addr: string; value: number }>
  unit: string
  highlightAddr?: string
  accent?: 'in' | 'out' | 'neutral'
}
function IoSection({ title, items, unit, highlightAddr, accent = 'neutral' }: IoSectionProps) {
  if (!items?.length) return null
  const total = items.reduce((s, it) => s + (Number(it.value) || 0), 0)
  const accentColor = accent === 'in' ? '#10b981' : accent === 'out' ? '#f87171' : '#94a3b8'
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>{title}</span>
          <span style={{ fontSize: 11, color: accentColor, padding: '1px 8px', borderRadius: 999, background: `${accentColor}1a`, border: `1px solid ${accentColor}33` }}>
            {items.length}
          </span>
        </div>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 11.5, color: '#e2e8f0' }} title={`${fmtNum(total, 8)} ${unit}`}>
          Σ {fmtNum(total)} {unit}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {items.map((item, i) => {
          const isSelf = highlightAddr && item.addr.toLowerCase() === highlightAddr.toLowerCase()
          return (
            <div
              key={`${item.addr}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '7px 10px',
                borderRadius: 8,
                background: isSelf ? 'rgba(59,130,246,0.08)' : i % 2 ? 'rgba(255,255,255,0.018)' : 'transparent',
                border: isSelf ? '1px solid rgba(59,130,246,0.25)' : '1px solid transparent',
              }}
            >
              <span style={{ fontSize: 10, color: '#64748b', width: 20, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>#{i + 1}</span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: isSelf ? '#60a5fa' : '#94a3b8', wordBreak: 'break-all', flex: 1, minWidth: 0 }} title={item.addr}>
                {item.addr}
              </span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', flexShrink: 0 }} title={`${fmtNum(item.value, 8)} ${unit}`}>
                {fmtNum(item.value)} {unit}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function HomePage() {
  const navigate = useNavigate()

  // Input state
  const [addr, setAddr] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  // Profile state
  const [chain, setChain] = useState<Chain>(null)
  const [summaryCards, setSummaryCards] = useState<SummaryCard[]>([])
  const [profileAddr, setProfileAddr] = useState('')
  const [profileSubline, setProfileSubline] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  // TX controls
  const [maxTx, setMaxTx] = useState(500)
  const [maxTxCap, setMaxTxCap] = useState(500)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [direction, setDirection] = useState('')
  const [includeInternal, setIncludeInternal] = useState(false)

  // Results
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [rows, setRows] = useState<AnyTx[]>([])
  const [allRows, setAllRows] = useState<AnyTx[]>([])
  const [quickFilter, setQuickFilter] = useState('')
  const [tableMeta, setTableMeta] = useState('')

  // Modal
  const [modalTx, setModalTx] = useState<AnyTx | null>(null)
  const [modalChain, setModalChain] = useState<Chain>(null)

  // Prefill from URL
  useEffect(() => {
    const preset = new URLSearchParams(location.search).get('w')
    if (preset === 'btc') {
      setAddr('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')
      setStatus('Адрес подставлен. Нажмите «Поиск», затем настройте выборку.')
    } else if (preset === 'eth') {
      setAddr('0x1111111122222222333333334444444455555555')
      setStatus('Адрес подставлен. Нажмите «Поиск», затем настройте выборку.')
    }
  }, [])

  // Quick filter logic
  useEffect(() => {
    if (!quickFilter.trim()) { setRows(allRows); return }
    const q = quickFilter.trim().toLowerCase()
    setRows(allRows.filter(tx => {
      const b = chain === 'BTC'
        ? `${tx.hash} ${tx.from} ${tx.to} ${((tx as BtcTx).inputs || []).map(i => i.addr).join(' ')} ${((tx as BtcTx).outputs || []).map(o => o.addr).join(' ')}`.toLowerCase()
        : `${tx.hash} ${tx.from} ${tx.to} ${(tx as EthTx).input || ''} ${(tx as EthTx).methodId || ''} ${(tx as EthTx).functionName || ''}`.toLowerCase()
      return b.includes(q)
    }))
  }, [quickFilter, allRows, chain])

  const resetState = () => {
    setSummaryCards([]); setProfileAddr(''); setProfileSubline('')
    setWarnings([]); setResult(null); setRows([]); setAllRows([])
    setQuickFilter(''); setTableMeta(''); setMaxTx(500); setMaxTxCap(500)
  }

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const a = addr.trim()
    if (!a) return
    const c = detectChain(a)
    if (!c) { setStatus('Не удалось распознать адрес. Поддерживаются BTC и ETH.'); return }
    resetState()
    setChain(c)
    setBusy(true)
    setStatus(c === 'BTC' ? 'Запрашиваем профиль Bitcoin…' : 'Запрашиваем профиль Ethereum…')
    try {
      const endpoint = c === 'BTC' ? `/api/btc/summary?address=${encodeURIComponent(a)}` : `/api/eth/summary?address=${encodeURIComponent(a)}`
      const res = await fetchWithTimeout(endpoint, 25000)
      if (!res.ok) throw new Error(await res.text() || 'Ошибка summary')
      const summary: BtcSummary | EthSummary = await res.json()

      setProfileAddr(a)
      setProfileSubline('Выберите объём выборки и фильтры, затем запросите транзакции.')

      const unit = c === 'BTC' ? 'BTC' : 'ETH'
      const nTx = (summary as BtcSummary).nTx
      setSummaryCards([
        { title: 'Всего транзакций', value: fmtInt(nTx) },
        { title: 'Баланс', value: `${fmtNum(summary.balance)} ${unit}` },
        { title: 'Всего получено', value: `${fmtNum(summary.totalReceived)} ${unit}` },
        { title: 'Всего отправлено', value: `${fmtNum(summary.totalSent)} ${unit}` },
        { title: 'Неизрасходованных выходов', value: fmtInt(summary.nUnredeemed) },
      ])

      const cap = typeof nTx === 'number' && nTx > 0 ? Math.min(20000, nTx) : 500
      setMaxTxCap(cap)
      setMaxTx(Math.min(500, cap))

      const txInfo = typeof nTx === 'number' && nTx >= 0
        ? `В сети у адреса ${fmtInt(nTx)} транзакций. Настройте выборку и нажмите «Выгрузить».`
        : 'Настройте выборку и нажмите «Выгрузить транзакции».'
      setStatus(txInfo)
    } catch (err: unknown) {
      setStatus(`Ошибка: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [addr])

  const handleExport = useCallback(async () => {
    if (!profileAddr || !chain) return
    setBusy(true)
    setStatus(`Загружаем до ${fmtInt(maxTx)} транзакций…`)
    try {
      const unit = chain === 'BTC' ? 'btc' : 'eth'
      const params = new URLSearchParams({ address: profileAddr, maxTx: String(maxTx) })
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      if (minAmount) params.set(chain === 'BTC' ? 'minBtc' : 'minEth', minAmount)
      if (maxAmount) params.set(chain === 'BTC' ? 'maxBtc' : 'maxEth', maxAmount)
      if (direction) params.set('direction', direction)
      if (chain === 'ETH' && includeInternal) params.set('includeInternal', '1')

      const res = await fetchWithTimeout(`/api/${unit}/analyze?${params}`, 175000)
      if (!res.ok) throw new Error(await res.text() || 'Ошибка analyze')
      const data: AnalyzeResult = await res.json()

      setWarnings(data.warnings || [])
      setResult(data)
      const txList = data.transactions || []
      setAllRows(txList)
      setRows(txList)
      setQuickFilter('')
      setTableMeta(`Запрошено: ${fmtInt(data.requestedFetch)} · загружено: ${fmtInt(data.fetched)} · после фильтров: ${fmtInt(data.afterFilters)}`)
      setStatus(`Готово. Показано ${fmtInt(data.afterFilters)} транзакций после фильтрации.`)
    } catch (err: unknown) {
      setStatus(`Ошибка: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [profileAddr, chain, maxTx, dateFrom, dateTo, minAmount, maxAmount, direction, includeInternal])

  const openModal = (tx: AnyTx) => { setModalTx(tx); setModalChain(chain); document.body.style.overflow = 'hidden' }
  const closeModal = () => { setModalTx(null); setModalChain(null); document.body.style.overflow = '' }

  // Keyboard close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && modalTx) closeModal() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [modalTx])

  const unit = chain === 'BTC' ? 'BTC' : chain === 'ETH' ? 'ETH' : ''

  // ─── BTC modal rows
  const getBtcModalRows = (tx: BtcTx) => [
    ['Сеть', 'BITCOIN'], ['Хэш', tx.hash],
    ['Обозреватель', safeUrl(tx.explorerUrl) ? `<a href="${safeUrl(tx.explorerUrl)}" target="_blank" rel="noreferrer" style="color:#60a5fa;">Открыть</a>` : '—'],
    ['Дата (UTC)', tx.date], ['Направление', tx.direction],
    ['Сумма (кошелёк)', `${fmtNum(tx.amount)} BTC`], ['Комиссия', `${fmtNum(tx.fee)} BTC`],
    ['Статус', tx.status], ['Версия / locktime', `${tx.version} / ${tx.lockTime}`],
    ['Размер / вес', `${tx.size} байт · ${tx.weight} wu`],
    ['Входы / выходы', `${tx.vinSz} / ${tx.voutSz}`], ['Блок', String(tx.blockHeight || '—')],
    ['Double-spend', tx.doubleSpend ? 'да' : 'нет'], ['Relayed by', tx.relayedBy || '—'],
    ['Сумма входов', `${fmtNum(tx.totalInValue)} BTC`], ['Сумма выходов', `${fmtNum(tx.totalOutValue)} BTC`],
    ['Первый вход → выход', `${tx.from || '—'} → ${tx.to || '—'}`],
  ]

  const getEthModalRows = (tx: EthTx) => {
    const totalIn = tx.direction === 'out' ? Number(tx.amount) + Number(tx.fee) : Number(tx.amount)
    const totalOut = tx.direction === 'in' ? Number(tx.amount) : 0
    return [
      ['Сеть', 'ETHEREUM'], ['Хэш', tx.hash],
      ['Обозреватель', safeUrl(tx.explorerUrl) ? `<a href="${safeUrl(tx.explorerUrl)}" target="_blank" rel="noreferrer" style="color:#60a5fa;">Открыть</a>` : '—'],
      ['Дата (UTC)', tx.date], ['Направление', tx.direction],
      ['Сумма (кошелёк)', `${fmtNum(tx.amount)} ETH`], ['Комиссия', `${fmtNum(tx.fee)} ETH`],
      ['Статус', tx.status], ['Nonce / подтверждения', `${tx.nonce} / ${tx.confirmations}`],
      ['Gas использовано / лимит', `${fmtInt(tx.gasUsed)} / ${fmtInt(tx.gas)}`],
      ['Блок / индекс', `${tx.blockNumber || '—'} / ${tx.transactionIndex}`],
      ['Сумма входов (все)', `${fmtNum(totalIn)} ETH`], ['Сумма выходов (все)', `${fmtNum(totalOut)} ETH`],
      ['Первый вход → выход', `${tx.from || '—'} → ${tx.to || '—'}`],
    ]
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', position: 'relative' }}>
      <HexCanvas />

      {/* Aurora blobs */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)', top: '-10%', left: '-5%', animation: 'aMove 18s ease-in-out infinite alternate' }} />
        <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(8,145,178,0.05) 0%, transparent 70%)', bottom: '-10%', right: '-5%', animation: 'aMove2 14s ease-in-out infinite alternate' }} />
      </div>

      {/* Top Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(5,8,16,0.85)', backdropFilter: 'blur(20px)', padding: '0 32px', display: 'flex', alignItems: 'center', height: 56, gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 'auto' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#navGrad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="navGrad" x1="0" y1="0" x2="24" y2="24"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#0891b2" /></linearGradient></defs>
            <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
            <line x1="6" y1="6" x2="10" y2="11" /><line x1="18" y1="6" x2="14" y2="11" />
            <line x1="6" y1="18" x2="10" y2="13" /><line x1="18" y1="18" x2="14" y2="13" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: 15, background: 'linear-gradient(135deg,#e2e8f0,#94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Blockchain Forensics
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => navigate('/trace')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.28)', color: '#34d399', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.18)'; e.currentTarget.style.borderColor = 'rgba(16,185,129,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; e.currentTarget.style.borderColor = 'rgba(16,185,129,0.28)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            Trace
          </button>
          <button
            onClick={() => navigate('/forensics')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#60a5fa', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.18)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(59,130,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
              <line x1="6" y1="6" x2="10" y2="11" /><line x1="18" y1="6" x2="14" y2="11" />
              <line x1="6" y1="18" x2="10" y2="13" /><line x1="18" y1="18" x2="14" y2="13" />
            </svg>
            Граф
          </button>
        </div>
      </nav>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 960, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-1px', background: 'linear-gradient(135deg,#e2e8f0 30%,#60a5fa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: 12 }}>
            Анализ кошелька
          </h1>
          <p style={{ color: '#64748b', fontSize: 15 }}>Введите адрес Bitcoin или Ethereum для получения профиля и транзакций</p>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <input
            value={addr}
            onChange={e => setAddr(e.target.value)}
            placeholder="bc1q… или 0x…"
            disabled={busy}
            style={{
              flex: 1, padding: '13px 18px', borderRadius: 10, fontSize: 14,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#e2e8f0', fontFamily: 'var(--mono, monospace)', outline: 'none',
              transition: 'border-color .2s',
            }}
            onFocus={e => e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)'}
            onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: '13px 28px', borderRadius: 10, fontWeight: 600, fontSize: 14,
              background: 'linear-gradient(135deg,#2563eb,#0891b2)', border: 'none',
              color: '#fff', cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.7 : 1, transition: 'all .2s',
              boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
            }}
          >
            {busy ? 'Ждём…' : 'Поиск'}
          </button>
        </form>

        {/* Status */}
        {status && (
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 24, padding: '10px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {busy && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #3b82f6', borderTopColor: 'transparent', animation: 'spin .8s linear infinite', marginRight: 8, verticalAlign: 'middle' }} />}
            {status}
          </div>
        )}

        {/* Profile workbench */}
        {profileAddr && (
          <div style={{ animation: 'fadeIn .4s both' }}>
            {/* Forensics banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', marginBottom: 20,
              background: 'linear-gradient(135deg,rgba(37,99,235,0.12),rgba(8,145,178,0.08))',
              border: '1px solid rgba(59,130,246,0.25)', borderRadius: 12,
            }}>
              <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, background: 'linear-gradient(135deg,#2563eb,#0891b2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 16px rgba(59,130,246,0.3)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="4" cy="18" r="2" /><circle cx="20" cy="18" r="2" />
                  <line x1="6" y1="6" x2="10" y2="11" /><line x1="18" y1="6" x2="14" y2="11" />
                  <line x1="6" y1="18" x2="10" y2="13" /><line x1="18" y1="18" x2="14" y2="13" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>Открыть граф транзакций</div>
                <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Визуализировать связи и риски для{' '}
                  <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{shortAddr(profileAddr)}</span>
                </div>
              </div>
              <button
                onClick={() => navigate(`/forensics?address=${encodeURIComponent(profileAddr)}`)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', whiteSpace: 'nowrap',
                  background: 'linear-gradient(135deg,#2563eb,#0891b2)', borderRadius: 8,
                  color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: 'none', flexShrink: 0, boxShadow: '0 4px 14px rgba(59,130,246,0.3)', transition: 'box-shadow .2s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(59,130,246,0.5)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = '0 4px 14px rgba(59,130,246,0.3)'}
              >
                Открыть Forensics →
              </button>
            </div>

            {/* Address headline */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ padding: '3px 10px', borderRadius: 6, background: chain === 'BTC' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)', color: chain === 'BTC' ? '#f59e0b' : '#60a5fa', fontSize: 11, fontWeight: 700, letterSpacing: '.5px' }}>{chain}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortAddr(profileAddr)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{profileSubline}</div>
            </div>

            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
              {summaryCards.map((c, i) => <MetricCard key={i} title={c.title} value={c.value} delay={i * 55} />)}
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {warnings.map((w, i) => (
                  <span key={i} style={{ padding: '4px 12px', borderRadius: 20, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', fontSize: 12 }}>{w}</span>
                ))}
              </div>
            )}

            {/* TX Controls */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <label style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap' }}>Транзакций в выборке</label>
                <input type="range" min={1} max={maxTxCap} value={maxTx}
                  onChange={e => setMaxTx(Number(e.target.value))}
                  style={{ flex: 1, minWidth: 120, accentColor: '#3b82f6' }}
                />
                <input type="number" min={1} max={maxTxCap} value={maxTx}
                  onChange={e => { const v = Math.min(maxTxCap, Math.max(1, Number(e.target.value))); setMaxTx(v) }}
                  style={{ width: 80, padding: '6px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13, textAlign: 'center' }}
                />
                <span style={{ padding: '4px 12px', borderRadius: 20, background: 'rgba(59,130,246,0.12)', color: '#60a5fa', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtInt(maxTx)} шт.</span>
              </div>

              {/* Filters */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
                <FilterField label="Дата с" type="date" value={dateFrom} onChange={setDateFrom} />
                <FilterField label="Дата по" type="date" value={dateTo} onChange={setDateTo} />
                <FilterField label={`Мин. ${unit}`} type="number" value={minAmount} onChange={setMinAmount} placeholder="0.001" />
                <FilterField label={`Макс. ${unit}`} type="number" value={maxAmount} onChange={setMaxAmount} placeholder="100" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px' }}>Направление</label>
                  <select value={direction} onChange={e => setDirection(e.target.value)}
                    style={{ padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13 }}>
                    <option value="">Все</option>
                    <option value="in">Входящие</option>
                    <option value="out">Исходящие</option>
                  </select>
                </div>
                {chain === 'ETH' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end', paddingBottom: 6 }}>
                    <input type="checkbox" id="inclInternal" checked={includeInternal} onChange={e => setIncludeInternal(e.target.checked)} style={{ accentColor: '#3b82f6', width: 15, height: 15 }} />
                    <label htmlFor="inclInternal" style={{ fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>Внутренние TX</label>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button onClick={handleExport} disabled={busy}
                  style={{ padding: '10px 22px', borderRadius: 9, fontWeight: 600, fontSize: 13, background: 'linear-gradient(135deg,#2563eb,#0891b2)', border: 'none', color: '#fff', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1, boxShadow: '0 4px 12px rgba(37,99,235,0.25)', transition: 'all .2s' }}>
                  {busy ? 'Загрузка…' : 'Выгрузить транзакции'}
                </button>
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setMinAmount(''); setMaxAmount(''); setDirection(''); setIncludeInternal(false) }}
                  style={{ padding: '10px 18px', borderRadius: 9, fontSize: 13, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', cursor: 'pointer', transition: 'all .2s' }}>
                  Сбросить фильтры
                </button>
              </div>
            </div>

            {/* Result overview */}
            {result && (
              <div style={{ marginBottom: 20, animation: 'fadeIn .4s both' }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>Итоги запроса</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10 }}>
                  {(chain === 'BTC' ? [
                    ['Сеть', 'BITCOIN'], ['Баланс', `${fmtNum(result.balance)} BTC`],
                    ['В сети транзакций', fmtInt(result.totalOnChain)], ['Загружено', fmtInt(result.fetched)],
                    ['После фильтров', fmtInt(result.afterFilters)], ['Входящих', fmtInt(result.incomingTx)],
                    ['Исходящих', fmtInt(result.outgoingTx)], ['Сумма входов', `${fmtNum(result.totalIn)} BTC`],
                    ['Сумма выходов', `${fmtNum(result.totalOut)} BTC`], ['Чистый поток', `${fmtNum(result.netFlow)} BTC`],
                    ['Нейтральных', fmtInt(result.skippedNeutral)],
                  ] : [
                    ['Сеть', 'ETHEREUM'], ['Баланс', `${fmtNum(result.balance)} ETH`],
                    ['В сети транзакций', fmtInt(result.totalOnChain)], ['Загружено', fmtInt(result.fetched)],
                    ['После фильтров', fmtInt(result.afterFilters)], ['Входящих', fmtInt(result.incomingTx)],
                    ['Исходящих', fmtInt(result.outgoingTx)], ['Сумма входов', `${fmtNum(result.totalIn)} ETH`],
                    ['Сумма выходов', `${fmtNum(result.totalOut)} ETH`], ['Чистый поток', `${fmtNum(result.netFlow)} ETH`],
                    ['Нейтральных', fmtInt(result.skippedNeutral)],
                  ]).map(([t, v], i) => <MetricCard key={i} title={t} value={v} delay={i * 35} />)}
                </div>
              </div>
            )}

            {/* Transaction table */}
            {allRows.length > 0 && (
              <div style={{ animation: 'fadeIn .4s both' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                  <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 600 }}>Транзакции</div>
                  <input
                    value={quickFilter} onChange={e => setQuickFilter(e.target.value)}
                    placeholder="Быстрый поиск по хэшу, адресу…"
                    style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#e2e8f0', fontSize: 13, width: 260 }}
                  />
                </div>
                {tableMeta && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{tableMeta}</div>}

                <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: 140 }} />
                      <col style={{ width: 64 }} />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 96 }} />
                      <col /> {/* hash — takes remaining */}
                    </colgroup>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                        {(chain === 'BTC'
                          ? ['Дата', 'Dir', 'Сумма BTC', 'Комиссия', 'Размер/Вес', 'Блок', 'Статус', 'Хэш транзакции']
                          : ['Дата', 'Dir', 'Сумма ETH', 'Комиссия', 'Gas исп./лим.', 'Блок', 'Статус', 'Хэш транзакции']
                        ).map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', whiteSpace: 'nowrap', overflow: 'hidden' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Нет строк для отображения.</td></tr>
                      ) : rows.map((tx, i) => (
                        <TxRow key={i} tx={tx} chain={chain!} onClick={() => openModal(tx)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* TX Detail Modal */}
      {modalTx && (
        <div
          onClick={e => { if (e.currentTarget === e.target) closeModal() }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div style={{ background: '#080d1c', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'fadeIn .25s both' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>Детали транзакции</span>
              <button onClick={closeModal} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, width: 32, height: 32, color: '#94a3b8', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '20px 24px' }}>
              <dl style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0', marginBottom: 16 }}>
                {(modalChain === 'BTC' ? getBtcModalRows(modalTx as BtcTx) : getEthModalRows(modalTx as EthTx)).map(([k, v], i) => (
                  <Fragment key={`row-${i}`}>
                    <dt style={{ padding: '8px 12px 8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#64748b', fontSize: 12 }}>{k}</dt>
                    <dd style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 12, fontFamily: 'var(--mono,monospace)', wordBreak: 'break-all', overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: v }} />
                  </Fragment>
                ))}
              </dl>
              {modalChain === 'BTC' && (
                <>
                  <IoSection
                    title="Входы (отправители)"
                    items={(modalTx as BtcTx).inputs || []}
                    unit="BTC"
                    highlightAddr={profileAddr}
                    accent="out"
                  />
                  <IoSection
                    title="Выходы (получатели)"
                    items={(modalTx as BtcTx).outputs || []}
                    unit="BTC"
                    highlightAddr={profileAddr}
                    accent="in"
                  />
                </>
              )}
              {modalChain === 'ETH' && (
                <>
                  <IoSection
                    title="От"
                    items={(modalTx as EthTx).from ? [{ addr: (modalTx as EthTx).from, value: modalTx.amount }] : []}
                    unit="ETH"
                    highlightAddr={profileAddr}
                    accent="out"
                  />
                  <IoSection
                    title="Кому"
                    items={(modalTx as EthTx).to ? [{ addr: (modalTx as EthTx).to, value: modalTx.amount }] : []}
                    unit="ETH"
                    highlightAddr={profileAddr}
                    accent="in"
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── FilterField helper ────────────────────────────────────────────────────────
function FilterField({ label, type, value, onChange, placeholder }: {
  label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{ padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', fontSize: 13 }}
      />
    </div>
  )
}

// ─── TxRow helper ─────────────────────────────────────────────────────────────
function TxRow({ tx, chain, onClick }: { tx: AnyTx; chain: Chain; onClick: () => void }) {
  const dir = tx.direction
  const pillStyle: React.CSSProperties = {
    padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
    background: dir === 'out' ? 'rgba(248,113,113,0.15)' : dir === 'in' ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.12)',
    color: dir === 'out' ? '#f87171' : dir === 'in' ? '#10b981' : '#94a3b8',
    border: `1px solid ${dir === 'out' ? 'rgba(248,113,113,0.3)' : dir === 'in' ? 'rgba(16,185,129,0.3)' : 'rgba(148,163,184,0.2)'}`,
  }
  const amtColor = dir === 'out' ? '#f87171' : dir === 'in' ? '#10b981' : '#94a3b8'
  const sign = dir === 'out' ? '−' : dir === 'in' ? '+' : ''
  const href = safeUrl(tx.explorerUrl)
  const unit = chain === 'BTC' ? 'BTC' : 'ETH'

  const col3 = chain === 'BTC'
    ? `${fmtInt((tx as BtcTx).size)} / ${fmtInt((tx as BtcTx).weight)}`
    : `${fmtInt((tx as EthTx).gasUsed)} / ${fmtInt((tx as EthTx).gas)}`
  const col4 = chain === 'BTC'
    ? (tx as BtcTx).blockHeight ? fmtInt((tx as BtcTx).blockHeight) : '—'
    : (tx as EthTx).blockNumber ? fmtInt((tx as EthTx).blockNumber) : '—'

  return (
    <tr onClick={onClick} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background .15s' }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12 }}>{toLocalDate(tx.date)}</td>
      <td style={{ padding: '10px 12px' }}><span style={pillStyle}>{dir}</span></td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: amtColor, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{sign}{fmtNum(tx.amount)} {unit}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b', fontSize: 12 }}>{fmtNum(tx.fee)}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b', fontSize: 12 }}>{col3}</td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b', fontSize: 12 }}>{col4}</td>
      <td style={{ padding: '10px 12px' }}>
        <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, background: tx.status === 'confirmed' ? 'rgba(16,185,129,0.12)' : 'rgba(248,113,113,0.12)', color: tx.status === 'confirmed' ? '#10b981' : '#f87171', border: `1px solid ${tx.status === 'confirmed' ? 'rgba(16,185,129,0.25)' : 'rgba(248,113,113,0.25)'}` }}>{tx.status}</span>
      </td>
      <td style={{ padding: '10px 12px', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {href
          ? <a href={href} target="_blank" rel="noreferrer" style={{ fontFamily: 'monospace', fontSize: 12, color: '#60a5fa', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.hash}>{tx.hash}</a>
          : <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tx.hash}>{tx.hash}</span>
        }
      </td>
    </tr>
  )
}
