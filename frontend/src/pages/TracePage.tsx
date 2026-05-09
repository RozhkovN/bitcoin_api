import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTrace, type TraceResponse, type TraceNode } from '../api'
import { fmt8, fmtCompact, shortAddr } from '../utils/format'
import Toast from '../components/Toast/Toast'
import { useStore } from '../store'

const TRACE_SESSION_KEY = 'bf_trace_session_v1'
const TRACE_LAST_MS_KEY = 'bf_trace_last_ms'

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

interface SavedTrace {
  hash: string
  depth: number
  direction: 'both' | 'forward' | 'backward'
  data: TraceResponse
}

export default function TracePage() {
  const navigate = useNavigate()
  const addToast = useStore(s => s.addToast)

  const [hash, setHash] = useState('')
  const [depth, setDepth] = useState(5)
  const [direction, setDirection] = useState<'both' | 'forward' | 'backward'>('both')
  const [loading, setLoading] = useState(false)
  const [loadingSince, setLoadingSince] = useState<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [lastTraceMs, setLastTraceMs] = useState<number>(() => {
    const raw = localStorage.getItem(TRACE_LAST_MS_KEY)
    const n = Number(raw || 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const [data, setData] = useState<TraceResponse | null>(null)
  const [, setHoverNode] = useState<TraceNode | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const restoredRef = useRef(false)
  const timeoutRef = useRef<number | null>(null)
  const sessionWarnedRef = useRef(false)

  // Восстановление сессии (отдельный ключ — чтобы не пересекалось с форензикой).
  // Если URL содержит ?hash=... — сразу запускаем трассировку этого hash.
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    const url = new URL(window.location.href)
    const param = url.searchParams.get('hash')
    if (param) {
      setHash(param)
      url.searchParams.delete('hash')
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
      // запускаем после монтирования (handleTrace ещё не определён в этот момент,
      // поэтому отложим в microtask)
      Promise.resolve().then(() => handleTrace(param))
      return
    }

    try {
      const raw = sessionStorage.getItem(TRACE_SESSION_KEY)
      if (!raw) return
      const session: SavedTrace = JSON.parse(raw)
      if (!session?.data?.nodes) return
      setHash(session.hash)
      setDepth(session.depth)
      setDirection(session.direction)
      setData(session.data)
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!data) return
    try {
      const session: SavedTrace = { hash, depth, direction, data }
      sessionStorage.setItem(TRACE_SESSION_KEY, JSON.stringify(session))
      sessionWarnedRef.current = false
    } catch {
      if (!sessionWarnedRef.current) {
        sessionWarnedRef.current = true
        addToast(
          'Не удалось сохранить трассировку в sessionStorage (лимит размера). Оставайся на этой вкладке или скопируй адреса блоком ниже перед закрытием.',
          'error',
          8000,
        )
      }
    }
  }, [data, hash, depth, direction, addToast])

  // Таймер визуального прогресса во время загрузки.
  useEffect(() => {
    if (!loadingSince) return
    const id = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - loadingSince) / 1000))
    }, 300)
    return () => window.clearInterval(id)
  }, [loadingSince])

  // Грубая оценка ожидания по параметрам трассировки.
  const estimatedSec = useMemo(() => {
    if (lastTraceMs > 0) {
      return Math.max(6, Math.min(180, Math.round(lastTraceMs / 1000)))
    }
    const dirFactor = direction === 'both' ? 2.0 : 1.15
    const depthFactor = Math.max(1, depth) * 4.2
    // базовые сетевые задержки + обработка
    return Math.min(120, Math.max(8, Math.round(4 + depthFactor * dirFactor)))
  }, [depth, direction, lastTraceMs])

  const loadingProgressPct = useMemo(() => {
    if (!loading) return 0
    if (estimatedSec <= 0) return 10
    const ratio = elapsedSec / estimatedSec
    // До ответа не показываем 100%, чтобы не «застрять» на полном.
    return Math.max(3, Math.min(95, Math.round(ratio * 100)))
  }, [loading, elapsedSec, estimatedSec])

  const loadingStage = useMemo(() => {
    const p = loadingProgressPct
    if (p < 15) return 'Подготовка запроса'
    if (p < 55) return 'Сканирую связи и tx'
    if (p < 85) return 'Собираю граф и статистику'
    return 'Финализирую ответ'
  }, [loadingProgressPct])

  const handleTrace = useCallback(async (txHash: string) => {
    if (!txHash.trim()) return
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setLoadingSince(Date.now())
    setElapsedSec(0)
    setSelected(null)
    const startedAt = Date.now()
    timeoutRef.current = window.setTimeout(() => {
      abortRef.current?.abort()
      addToast('Трассировка отменена по таймауту (90с). Уменьши глубину или выбери одно направление.', 'error', 7000)
    }, 90000)
    try {
      const result = await fetchTrace(txHash.trim(), depth, direction, abortRef.current.signal)
      setData(result)
      const duration = Date.now() - startedAt
      setLastTraceMs(duration)
      localStorage.setItem(TRACE_LAST_MS_KEY, String(duration))
      addToast(`Найдено ${result.stats.totalNodes} TX, ${result.stats.totalEdges} переходов`, 'success')
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        addToast('Ошибка трассировки: ' + (err?.message || err), 'error', 5000)
      } else if (elapsedSec > 1) {
        addToast('Трассировка остановлена', 'error', 2500)
      }
    } finally {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      setLoading(false)
      setLoadingSince(null)
    }
  }, [depth, direction, addToast, elapsedSec])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    handleTrace(hash)
  }

  // Группировка узлов по depth для timeline-раскладки
  const lanes = useMemo(() => {
    if (!data) return new Map<number, TraceNode[]>()
    const map = new Map<number, TraceNode[]>()
    data.nodes.forEach(n => {
      const arr = map.get(n.depth) || []
      arr.push(n)
      map.set(n.depth, arr)
    })
    // sort by time within each lane
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.time || 0) - (b.time || 0))
    }
    return map
  }, [data])

  const sortedDepths = useMemo(() => {
    return Array.from(lanes.keys()).sort((a, b) => a - b)
  }, [lanes])

  const nodeMap = useMemo(() => {
    const m = new Map<string, TraceNode>()
    data?.nodes.forEach(n => m.set(n.hash, n))
    return m
  }, [data])

  // ───────────────────────────────────────────────────────────────────────
  // Flow-метрика: сколько BTC реально дошло до root через каждый шаг.
  //
  //   • Edge.value = сумма конкретного output, который был истрачен.
  //   • Для backward (depth<0) edge идёт от старшей TX к младшей (ближе к root).
  //     Сумма edge.value, исходящих из узлов депзы d, — это «дотекло до root через слой d».
  //   • Для forward (depth>0) edge идёт от младшей к старшей. Сумма edge.value,
  //     ВХОДЯЩИХ в узлы депзы d, — это «вышло из root и достигло слоя d».
  //
  // Так пользователь видит реальный «расход» средств root, а не суммы случайных
  // других выходов чужих транзакций (которые не имеют отношения к нашим деньгам).
  const flowByLane = useMemo(() => {
    const m = new Map<number, number>()
    if (!data) return m
    data.edges.forEach(e => {
      const from = nodeMap.get(e.from)
      const to = nodeMap.get(e.to)
      if (!from || !to) return
      // backward: edge идёт от depth -d (старая) → depth -(d-1) (новая, ближе к root)
      // → flow слоя -d = сумма исходящих edge.value
      if (from.depth < 0) {
        m.set(from.depth, (m.get(from.depth) || 0) + e.value)
      } else if (to.depth > 0) {
        // forward: edge идёт от depth (d-1) → depth d
        // → flow слоя d = сумма входящих edge.value
        m.set(to.depth, (m.get(to.depth) || 0) + e.value)
      }
    })
    // ROOT: в заголовке колонки — сумма входов (что пришло «слева» в эту TX)
    if (data.nodes.length > 0) {
      const root = data.nodes.find(n => n.isRoot)
      if (root) m.set(0, root.totalIn)
    }
    return m
  }, [data, nodeMap])

  // Сколько value «через» каждый отдельный TX-узел дошло до root.
  // Для backward TX: сумма исходящих edges (то есть value отправлений ВНИЗ цепи в сторону root).
  // Для forward TX: сумма входящих edges (то есть сколько денег root «дотекло» сюда).
  const nodeFlowToRoot = useMemo(() => {
    const m = new Map<string, number>()
    if (!data) return m
    data.edges.forEach(e => {
      const from = nodeMap.get(e.from)
      const to = nodeMap.get(e.to)
      if (!from || !to) return
      if (from.depth < 0) {
        m.set(from.hash, (m.get(from.hash) || 0) + e.value)
      } else if (to.depth > 0) {
        m.set(to.hash, (m.get(to.hash) || 0) + e.value)
      }
    })
    return m
  }, [data, nodeMap])

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', overflow: 'hidden' }}>
      <Toast />

      {/* Background gradient */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse at 20% 0%, rgba(59,130,246,0.08), transparent 50%),
          radial-gradient(ellipse at 80% 100%, rgba(139,92,246,0.06), transparent 50%)
        `,
      }} />

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px',
        background: 'rgba(5,8,16,0.85)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg,#10b981,#0ea5e9)', borderRadius: 9,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.2 }}>Trace · Движение средств</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>UTXO-трассировка цепочки транзакций</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => navigate('/forensics')}
            style={{
              padding: '7px 14px', borderRadius: 8,
              background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
              color: '#60a5fa', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >Граф связей</button>
          <button
            onClick={() => navigate('/')}
            style={{
              padding: '7px 14px', borderRadius: 8,
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text2)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
            }}
          >На главную</button>
        </div>
      </header>

      {/* Search */}
      <div style={{ position: 'relative', zIndex: 1, padding: '24px', maxWidth: 1280, margin: '0 auto' }}>
        <form onSubmit={onSubmit} style={{
          display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
          background: 'rgba(15,23,42,0.55)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 14,
          backdropFilter: 'blur(12px)',
        }}>
          <input
            type="text"
            value={hash}
            onChange={e => setHash(e.target.value)}
            placeholder="Хэш транзакции (txid) — Bitcoin"
            style={{
              flex: '1 1 380px', padding: '11px 14px', borderRadius: 8,
              background: 'rgba(0,0,0,0.32)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)',
              outline: 'none',
            }}
          />
          <select
            value={direction}
            onChange={e => setDirection(e.target.value as any)}
            style={{
              padding: '10px 12px', borderRadius: 8, fontSize: 12,
              background: 'rgba(0,0,0,0.32)', border: '1px solid var(--border)', color: 'var(--text)',
            }}
          >
            <option value="both">↔ В обе стороны</option>
            <option value="backward">← Откуда пришли</option>
            <option value="forward">→ Куда ушли</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
            Глубина
            <input
              type="number" min={1} max={8}
              value={depth}
              onChange={e => setDepth(Math.max(1, Math.min(8, Number(e.target.value) || 5)))}
              style={{
                width: 56, padding: '8px 10px', borderRadius: 8, fontSize: 12,
                background: 'rgba(0,0,0,0.32)', border: '1px solid var(--border)', color: 'var(--text)',
              }}
            />
          </label>
          <button
            type="submit"
            disabled={loading || !hash.trim()}
            style={{
              padding: '10px 22px', borderRadius: 8,
              background: loading ? 'rgba(59,130,246,0.4)' : 'linear-gradient(135deg,#2563eb,#0891b2)',
              border: 'none', color: '#fff', fontWeight: 500, fontSize: 13,
              cursor: loading || !hash.trim() ? 'not-allowed' : 'pointer',
              opacity: !hash.trim() ? 0.6 : 1,
            }}
          >{loading ? 'Трассирую…' : 'Запустить трассировку'}</button>
        </form>

        {/* Stats summary */}
        {data && (
          <div style={{
            marginTop: 16,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10,
          }}>
            <StatCard label="Всего TX" value={String(data.stats.totalNodes)} accent="#3b82f6" />
            <StatCard label="Назад" value={String(data.stats.backward)} accent="#06b6d4" />
            <StatCard label="Вперёд" value={String(data.stats.forward)} accent="#10b981" />
            <StatCard label="Адресов" value={String(data.stats.uniqueAddrs)} accent="#f59e0b" />
            <StatCard label="Объём" value={`${fmtCompact(data.stats.totalValue)} BTC`} accent="#8b5cf6" />
            {data.meta.cached && (
              <StatCard label="Кэш" value={`из БД · ${data.meta.cacheAgeS || 0}с назад`} accent="#22c55e" />
            )}
            {data.meta.truncated && (
              <StatCard label="Внимание" value="Лимит достигнут" accent="#f87171" />
            )}
          </div>
        )}

        {/* Empty / loading */}
        {!data && !loading && (
          <div style={{
            marginTop: 60, textAlign: 'center', padding: '40px 20px',
            color: 'var(--text3)', fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 16 }}>🧭</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--text2)' }}>
              Введи txid интересующей транзакции
            </div>
            <div>
              Trace покажет полную цепочку UTXO: куда дальше ушли деньги (vout&nbsp;→&nbsp;next&nbsp;tx)<br />
              и откуда пришли (vin&nbsp;←&nbsp;prev&nbsp;tx) — с шагом до 8 уровней.
            </div>
          </div>
        )}
        {loading && (
          <div style={{
            marginTop: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            color: 'var(--text2)',
          }}>
            <div style={{ width: 44, height: 44, position: 'relative' }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid transparent', borderTopColor: 'var(--accent)', borderRightColor: 'rgba(59,130,246,0.4)',
                animation: 'spin 0.9s linear infinite',
              }} />
            </div>
            <div style={{ fontSize: 13, textAlign: 'center' }}>
              Иду по цепочке транзакций… {loadingProgressPct}% · прошло {elapsedSec}с
            </div>
            <div style={{ fontSize: 11, color: '#93c5fd' }}>{loadingStage}</div>
            <div style={{
              width: 'min(560px, 90%)',
              height: 8,
              borderRadius: 999,
              background: 'rgba(148,163,184,.18)',
              overflow: 'hidden',
              border: '1px solid rgba(148,163,184,.24)',
            }}>
              <div style={{
                height: '100%',
                width: `${loadingProgressPct}%`,
                transition: 'width .35s ease',
                background: 'linear-gradient(90deg, #2563eb, #06b6d4)',
              }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {elapsedSec < estimatedSec
                ? `Осталось примерно ${Math.max(1, estimatedSec - elapsedSec)}с`
                : 'Дольше обычного — можно подождать или отменить'}
            </div>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              style={{
                marginTop: 2,
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid rgba(248,113,113,.35)',
                background: 'rgba(248,113,113,.10)',
                color: '#fca5a5',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Отменить трассировку
            </button>
          </div>
        )}

        {data && data.nodes.length > 0 && (
          <AddressExplorer data={data} onCopied={msg => addToast(msg, 'success', 1800)} />
        )}

        {/* Объяснение, как читать таймлайн */}
        {data && data.nodes.length > 0 && (
          <ExplainPanel />
        )}

        {/* Timeline */}
        {data && data.nodes.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Timeline
              data={data}
              lanes={lanes}
              sortedDepths={sortedDepths}
              flowByLane={flowByLane}
              nodeFlowToRoot={nodeFlowToRoot}
              onCopied={msg => addToast(msg, 'success', 1800)}
              setHoverNode={setHoverNode}
              selected={selected}
              setSelected={setSelected}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(96,165,250,.55); }
          50% { box-shadow: 0 0 0 6px rgba(96,165,250,0); }
        }
      `}</style>
    </div>
  )
}

function ExplainPanel() {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      marginTop: 16,
      background: 'rgba(15,23,42,0.5)', border: '1px solid var(--border)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text)', fontSize: 13, fontWeight: 500,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(59,130,246,.15)', color: '#60a5fa', fontSize: 12, fontWeight: 700,
          }}>i</span>
          Как читать таймлайн и почему числа большие
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: '.2s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{
          padding: '4px 16px 16px', fontSize: 12, lineHeight: 1.65, color: 'var(--text2)',
          borderTop: '1px solid var(--border)',
        }}>
          <p style={{ margin: '10px 0' }}>
            <b style={{ color: 'var(--text)' }}>ROOT</b> — твоя транзакция. Каждая колонка слева — шаг
            <b style={{ color: '#06b6d4' }}> назад </b>(где деньги были <i>до</i> root), справа —
            шаг <b style={{ color: '#10b981' }}>вперёд</b> (куда деньги ушли <i>после</i> root).
          </p>
          <p style={{ margin: '10px 0' }}>
            <b style={{ color: '#06b6d4' }}>Шаг назад&nbsp;1</b>{' '}
            — сумма BTC в заголовке колонки (по рёбрам «родитель&nbsp;→&nbsp;ROOT») должна совпадать
            с суммой входов ROOT (до комиссии). Десять входов на 10&nbsp;BTC — ожидаем ~10&nbsp;BTC
            между всеми карточками первого столбца; несколько входов могут приходить из одной предыдущей
            транзакции (тогда карточек меньше&nbsp;10, но сумма всё равно ~10&nbsp;BTC).
          </p>
          <p style={{ margin: '10px 0' }}>
            UTXO-цепочка <b>фанаутится</b>: одна TX обычно тратит несколько входов, у каждого свой prev-tx,
            у каждой prev-tx — свои входы. Поэтому шаг 6 назад может содержать десятки транзакций — это
            <i> предки</i> root, а не «двойники» твоих 100 BTC.
          </p>
          <p style={{ margin: '10px 0' }}>
            <b style={{ color: '#60a5fa' }}>Цифра в заголовке колонки</b> (например «6 730 BTC») — это
            сумма value у рёбер, идущих через этот шаг по нашей цепочке. На дальних шагах сюда суммируется
            и «не наша» часть UTXO (у предка много выходов, наш — лишь один из них), поэтому число
            обычно превышает изначальный объём root. Это нормально для UTXO-модели: чем глубже идём,
            тем шире становится граф предков.
          </p>
          <p style={{ margin: '10px 0' }}>
            На каждой карточке в строке <b style={{ color: '#60a5fa' }}>↔ к ROOT</b> показано value
            конкретно того output/input, через который эта TX связана с твоей цепочкой. Это и есть «сколько
            именно из этой TX относится к root».
          </p>
          <p style={{ margin: '10px 0 0', color: 'var(--text3)' }}>
            Лимиты: до 8 шагов в каждую сторону и до ~220 уникальных TX на направление; при необходимости
            узел всё равно попадает в граф, но дальше по нему обход может обрезаться — тогда показывается
            «Лимит достигнут».
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      background: 'rgba(15,23,42,0.5)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '11px 14px',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: accent }}>{value}</div>
    </div>
  )
}

function CopyTiny({ text, onCopied, aria }: { text: string; onCopied: (msg: string) => void; aria?: string }) {
  if (!text) return null
  return (
    <button
      type="button"
      aria-label={aria || 'Копировать'}
      onClick={async e => {
        e.stopPropagation()
        const ok = await copyToClipboard(text)
        onCopied(ok ? 'Скопировано в буфер' : 'Не удалось скопировать')
      }}
      title="Копировать"
      style={{
        flexShrink: 0,
        padding: '2px 6px',
        borderRadius: 6,
        fontSize: 10,
        lineHeight: 1.2,
        border: '1px solid var(--border)',
        background: 'rgba(96,165,250,.06)',
        color: '#93c5fd',
        cursor: 'pointer',
      }}
    >
      ⧉
    </button>
  )
}

function AddressExplorer({ data, onCopied }: { data: TraceResponse; onCopied: (m: string) => void }) {
  const [q, setQ] = useState('')

  const txIds = useMemo(() => [...new Set(data.nodes.map(n => n.hash))].sort(), [data])
  const addrs = useMemo(() => {
    const s = new Set<string>()
    data.nodes.forEach(n => {
      n.inputs.forEach(i => { if (i.addr?.trim()) s.add(i.addr.trim()) })
      n.outputs.forEach(o => { if (o.addr?.trim()) s.add(o.addr.trim()) })
    })
    return [...s].sort()
  }, [data])

  const norm = q.trim().toLowerCase()
  const addrsFiltered = norm
    ? addrs.filter(a => a.toLowerCase().includes(norm))
    : addrs
  const txFiltered = norm
    ? txIds.filter(h => h.toLowerCase().includes(norm))
    : txIds

  const exportBlock = `${txFiltered.join('\n')}\n\n--- адреса ---\n${addrsFiltered.join('\n')}`

  return (
    <div style={{
      marginTop: 16,
      padding: 14,
      background: 'rgba(15,23,42,0.45)',
      border: '1px solid var(--border)',
      borderRadius: 12,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600, marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      }}>
        <span>Адреса и txid — поиск своих совпадений</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Фильтр (подстрока адреса / txid)…"
            style={{
              minWidth: 200, padding: '7px 10px', borderRadius: 8, fontSize: 12,
              background: 'rgba(0,0,0,.3)', border: '1px solid var(--border)', color: 'var(--text)',
            }}
          />
          <button
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(addrsFiltered.join('\n'))
              onCopied(ok ? `Адресов в буфере: ${addrsFiltered.length}` : 'Не удалось скопировать')
            }}
            style={{
              padding: '7px 12px',
              borderRadius: 8, fontSize: 11,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,.03)', color: 'var(--text2)', cursor: 'pointer',
            }}
          >
            Только адреса
          </button>
          <button
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(exportBlock)
              onCopied(ok
                ? `Экспорт: ${txFiltered.length} txid, ${addrsFiltered.length} адресов`
                : 'Не удалось скопировать')
            }}
            style={{
              padding: '7px 12px',
              borderRadius: 8, fontSize: 11,
              border: '1px solid rgba(96,165,250,.35)',
              background: 'rgba(59,130,246,.14)', color: '#93c5fd', cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Копировать txid → адреса (блок)
          </button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
        {addrs.length} уникальных адресов · {txIds.length} транзакций в графе. Вставляй блок в свой список
        наблюдений или ищи F3 по фильтру.
      </div>
      <textarea
        readOnly
        value={exportBlock}
        style={{
          width: '100%', minHeight: 120, maxHeight: 220, resize: 'vertical',
          fontFamily: 'var(--mono)', fontSize: 10, lineHeight: 1.4,
          background: 'rgba(0,0,0,.35)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text2)', padding: 10,
        }}
      />
    </div>
  )
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

interface TimelineProps {
  data: TraceResponse
  lanes: Map<number, TraceNode[]>
  sortedDepths: number[]
  flowByLane: Map<number, number>
  nodeFlowToRoot: Map<string, number>
  onCopied: (msg: string) => void
  setHoverNode: (n: TraceNode | null) => void
  selected: string | null
  setSelected: (h: string | null) => void
}

function Timeline({
  data, lanes, sortedDepths, flowByLane, nodeFlowToRoot, onCopied,
  setHoverNode, selected, setSelected,
}: TimelineProps) {
  const [laneLimit, setLaneLimit] = useState<Record<number, number>>({})
  const getLaneLimit = (d: number) => laneLimit[d] ?? 60
  return (
    <div style={{
      display: 'flex', gap: 28, padding: '20px 8px 28px',
      overflowX: 'auto', overflowY: 'hidden',
      background: 'rgba(15,23,42,0.45)', border: '1px solid var(--border)', borderRadius: 14,
      backdropFilter: 'blur(8px)',
      position: 'relative',
    }}>
      {sortedDepths.map(d => {
        const txs = lanes.get(d) || []
        const isRoot = d === 0
        const isPast = d < 0
        const isFuture = d > 0
        const laneColor = isRoot ? '#60a5fa' : isPast ? '#06b6d4' : '#10b981'
        const laneTitle = isRoot
          ? 'Запрошенная транзакция'
          : isPast
            ? `Назад · шаг ${Math.abs(d)}`
            : `Вперёд · шаг ${d}`

        return (
          <div key={d} style={{ minWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              position: 'sticky', top: 0,
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em',
              color: laneColor, padding: '6px 10px',
              background: 'rgba(5,8,16,0.7)', borderRadius: 8,
              border: `1px solid ${laneColor}33`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{laneTitle}</span>
              <span style={{ color: 'var(--text3)', fontWeight: 500 }} title="Сколько BTC реально перетекло через этот шаг по нашей цепочке (не общий объём чужих TX)">
                {txs.length} TX · {fmtCompact(flowByLane.get(d) || 0)} BTC
              </span>
            </div>

            {txs.slice(0, getLaneLimit(d)).map(tx => {
              const isSelected = selected === tx.hash
              const isRootTx = tx.hash === data.root
              return (
                <TxCard
                  key={tx.hash}
                  tx={tx}
                  laneColor={laneColor}
                  isRoot={isRootTx}
                  flowToRoot={nodeFlowToRoot.get(tx.hash)}
                  onCopied={onCopied}
                  isSelected={isSelected}
                  onClick={() => setSelected(isSelected ? null : tx.hash)}
                  onHover={(h: boolean) => setHoverNode(h ? tx : null)}
                />
              )
            })}
            {txs.length > getLaneLimit(d) && (
              <button
                type="button"
                onClick={() => setLaneLimit(prev => ({ ...prev, [d]: getLaneLimit(d) + 60 }))}
                style={{
                  marginTop: 6,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,.03)',
                  color: 'var(--text2)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Показать ещё {Math.min(60, txs.length - getLaneLimit(d))} из {txs.length - getLaneLimit(d)}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface TxCardProps {
  tx: TraceNode
  laneColor: string
  isRoot: boolean
  flowToRoot?: number
  onCopied: (msg: string) => void
  isSelected: boolean
  onClick: () => void
  onHover: (over: boolean) => void
}

function TxCard({ tx, laneColor, isRoot, flowToRoot, onCopied, isSelected, onClick, onHover }: TxCardProps) {
  const date = tx.time
    ? new Date(tx.time * 1000).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })
    : 'не подтверждена'
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        background: isRoot
          ? 'linear-gradient(135deg, rgba(59,130,246,0.20), rgba(8,145,178,0.12))'
          : 'rgba(15,23,42,0.65)',
        border: `1px solid ${isSelected ? laneColor : isRoot ? 'rgba(96,165,250,.5)' : 'var(--border)'}`,
        borderRadius: 11,
        padding: 12,
        cursor: 'pointer',
        transition: 'all .15s',
        boxShadow: isRoot ? '0 0 24px rgba(96,165,250,0.18)' : 'none',
        animation: isRoot ? 'pulseGlow 2.4s infinite' : undefined,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8, gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{
          fontSize: 11, fontFamily: 'var(--mono)',
          color: isRoot ? '#60a5fa' : 'var(--text)',
          fontWeight: 600,
        }}>{shortAddr(tx.hash)}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <CopyTiny text={tx.hash} aria="Копировать txid целиком" onCopied={onCopied} />
          {isRoot && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: '#60a5fa', color: '#0f172a', letterSpacing: '.05em',
            }}>ROOT</span>
          )}
          {tx.isCoinbase && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: '#f59e0b', color: '#0f172a', letterSpacing: '.05em',
            }}>COINBASE</span>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{date}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
        <div>
          <div style={{ color: 'var(--text3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em' }}>vin · {tx.inputs.length}</div>
          <div style={{ color: '#10b981', fontWeight: 500 }}>{fmtCompact(tx.totalIn)} BTC</div>
        </div>
        <div>
          <div style={{ color: 'var(--text3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em' }}>vout · {tx.outputs.length}</div>
          <div style={{ color: '#f87171', fontWeight: 500 }}>{fmtCompact(tx.totalOut)} BTC</div>
        </div>
      </div>

      {!isRoot && flowToRoot !== undefined && flowToRoot > 0 && (
        <div
          title="Сколько BTC связано с ROOT через нашу цепочку (через этот узел)"
          style={{
            marginTop: 8, padding: '6px 8px',
            background: 'rgba(96,165,250,.08)', borderRadius: 6,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 10,
          }}
        >
          <span style={{ color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            ↔ к&nbsp;ROOT
          </span>
          <span style={{ color: '#60a5fa', fontWeight: 600, fontFamily: 'var(--mono)' }}>
            {fmtCompact(flowToRoot)} BTC
          </span>
        </div>
      )}

      {isSelected && (
        <div style={{
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${laneColor}33`,
          fontSize: 11, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <DetailSection title="Входы" items={tx.inputs} accent="#10b981" onCopied={onCopied} />
          <DetailSection title="Выходы" items={tx.outputs} accent="#f87171" onCopied={onCopied} />
          <a
            href={tx.explorerUrl}
            target="_blank" rel="noopener"
            onClick={e => e.stopPropagation()}
            style={{
              fontSize: 11, color: '#60a5fa', textDecoration: 'none',
              padding: '6px 10px', background: 'rgba(96,165,250,.08)',
              borderRadius: 6, textAlign: 'center', marginTop: 4,
            }}
          >Открыть в mempool.space ↗</a>
        </div>
      )}
    </div>
  )
}

function DetailSection({ title, items, accent, onCopied }: {
  title: string
  items: { addr: string; value: number; index: number }[]
  accent: string
  onCopied: (msg: string) => void
}) {
  if (!items.length) return null
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
        {items.map((io, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            padding: '6px 8px', background: 'rgba(0,0,0,0.25)', borderRadius: 6,
            fontSize: 10, fontFamily: 'var(--mono)',
          }}>
            <div style={{ flex: '1 1 0', minWidth: 0, color: 'var(--text2)' }} title={io.addr || undefined}>
              <div style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                #{io.index} {io.addr || '∅ non-standard'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, flexShrink: 0 }}>
              <span style={{ color: accent, fontWeight: 500, whiteSpace: 'nowrap' }}>{fmt8(io.value)}</span>
              {io.addr ? (
                <CopyTiny text={io.addr} aria="Копировать адрес" onCopied={onCopied} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
