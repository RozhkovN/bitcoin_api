import { create } from 'zustand'
import type {
  GraphResponse, GraphNode, Chain, TrailEntry, NavEntry, Toast, ToastType,
} from '@/types'

const NAV_MAX = 30

interface ForensicsState {
  // Core data
  mergedGraph: GraphResponse | null
  currentAddr: string
  currentChain: Chain
  loading: boolean

  // Graph UI
  is3D: boolean
  maxNodes: number

  // Multi-mode
  multiMode: boolean
  analyzedAddresses: Set<string>
  walletTrail: TrailEntry[]
  // Кэш «сырых» графов по каждому проанализированному адресу.
  // Это ИСТИНА для мульти-режима: при любом setGraph / toggleMultiMode
  // mergedGraph детерминированно собирается из этого словаря, поэтому
  // включение/выключение мульти-режима всегда даёт согласованный результат.
  walletGraphs: Record<string, GraphResponse>

  // Navigation history
  navHistory: NavEntry[]
  navIdx: number
  navSkipSave: boolean

  // Selected node (right-panel)
  selectedNode: GraphNode | null

  // TX Sheet
  txSheetOpen: boolean
  txSheetFilter: 'in' | 'out' | ''
  txSheetSearch: string
  txSheetSort: string

  // TX Detail modal
  txDetailOpen: boolean
  txDetailHash: string
  txDetailDir: 'in' | 'out' | ''
  txDetailCounterparty: string
  txDetailAmount: number

  // Settings
  settingsOpen: boolean

  // Toasts
  toasts: Toast[]

  // TX step (how many more to load)
  txStep: number

  // Date filter
  dateFrom: string
  dateTo: string

  // В мульти-режиме: адрес, чьи данные показаны в левой панели.
  // '' = текущий/merged
  viewAddr: string

  // Actions
  setGraph: (g: GraphResponse, addr: string, chain: Chain) => void
  mergeGraph: (g: GraphResponse, addr: string) => void
  clearGraph: () => void
  setLoading: (v: boolean) => void
  toggle3D: () => void
  setMaxNodes: (n: number) => void
  toggleMultiMode: () => void
  setSelectedNode: (n: GraphNode | null) => void
  openTxSheet: () => void
  closeTxSheet: () => void
  setTxSheetFilter: (f: 'in' | 'out' | '') => void
  setTxSheetSearch: (s: string) => void
  setTxSheetSort: (s: string) => void
  openTxDetail: (hash: string, dir: 'in' | 'out' | '', counterparty: string, amount: number) => void
  closeTxDetail: () => void
  toggleSettings: () => void
  addToast: (msg: string, type: ToastType, duration?: number) => void
  removeToast: (id: string) => void
  setTxStep: (n: number) => void
  setDateFilter: (from: string, to: string) => void
  setViewAddr: (addr: string) => void
  navSave: () => void
  navBack: () => void
  navForward: () => void
  navRestore: (entry: NavEntry) => void
}

let toastCounter = 0

// Помечает все узлы графа как «принадлежащие» owner-кошельку.
// Это критично для мульти-режима: counterparties потом размещаются
// рядом со своим owner'ом, формируя отдельный «облачко».
function tagOwnership(g: GraphResponse, ownerAddr: string): GraphResponse {
  return {
    ...g,
    nodes: g.nodes.map(n => ({
      ...n,
      ownerAddr: n.ownerAddr || ownerAddr,
    })),
  }
}

// ─── Multi-mode merge: полное объединение графов ────────────────────────────
//
// При повторном анализе в мульти-режиме НЕ теряем ни одного узла/ребра:
//   • Все узлы и рёбра base сохраняются (контрагенты предыдущих кошельков).
//   • Все узлы и рёбра incoming добавляются (новый кошелёк + его контрагенты).
//   • Узлы пересечений (адрес был в base и пришёл в incoming) объединяются:
//       — старая позиция (x,y,z,vx,vy,vz) сохраняется → нет «разлёта»;
//       — txCount / volumes / risk берутся максимумом;
//       — флаг isAnalyzed «прилипает» (один раз поставлен — навсегда);
//       — isCenter обновляется на newCenter.
//   • Рёбра идентифицируются по id; коллизии перезаписываются incoming-копией.
//
// В итоге: цепочка переходов A → B → C даёт ОДИН граф,
// в котором видны связи A↔B↔C, общие контрагенты подсвечены, ничего не теряется.
//
function mergeGraphData(base: GraphResponse, incoming: GraphResponse, newCenter: string): GraphResponse {
  type GNode = import('@/types').GraphNode
  type GEdge = import('@/types').GraphEdge

  const nodeMap = new Map<string, GNode>()

  // 1. Все узлы из base (включая контрагентов прошлых кошельков).
  //    Прошлый центр становится «analyzed» — на нём видна метка пройденного.
  ;(base.nodes || []).forEach(n => {
    nodeMap.set(n.id, {
      ...n,
      // если узел уже когда-либо был центром или анализирован — это якорь цепочки
      isAnalyzed: !!(n.isAnalyzed || n.isCenter),
      isCenter: n.id === newCenter,
    })
  })

  // 2. Все узлы incoming. Если узел уже есть в base — мерджим, сохраняя позицию.
  ;(incoming.nodes || []).forEach(n => {
    const old = nodeMap.get(n.id)
    if (old) {
      nodeMap.set(n.id, {
        ...old,
        ...n,
        // координаты симуляции — только из base, чтобы граф не перестраивался
        x: (old as any).x, y: (old as any).y, z: (old as any).z,
        vx: (old as any).vx, vy: (old as any).vy, vz: (old as any).vz,
        fx: (old as any).fx, fy: (old as any).fy, fz: (old as any).fz,
        // owner = первый кошелёк, который «привёл» этот узел в граф;
        // если он уже был в base — оставляем его, иначе берём из incoming.
        ownerAddr: old.ownerAddr || n.ownerAddr,
        // склейка флагов
        isCenter: n.id === newCenter,
        isAnalyzed: !!(old.isAnalyzed || (old as any).isCenter || n.isAnalyzed),
        // агрегаты — максимум, чтобы не «потерять» статистику предыдущего анализа
        txCount: Math.max(old.txCount || 0, n.txCount || 0),
        totalIn: Math.max(old.totalIn || 0, n.totalIn || 0),
        totalOut: Math.max(old.totalOut || 0, n.totalOut || 0),
        netFlow: (Math.max(old.totalIn || 0, n.totalIn || 0)) - (Math.max(old.totalOut || 0, n.totalOut || 0)),
        riskScore: Math.max(old.riskScore || 0, n.riskScore || 0),
        riskLevel: n.riskLevel || old.riskLevel || 'low',
        firstSeen: minNonZero(old.firstSeen, n.firstSeen),
        lastSeen: Math.max(old.lastSeen || 0, n.lastSeen || 0),
      })
    } else {
      nodeMap.set(n.id, { ...n, isCenter: n.id === newCenter })
    }
  })

  // 3. Рёбра: ВСЕ из base + ВСЕ из incoming.
  //    Дубли по id перезаписываются incoming-версией (свежее время/хэш).
  const edgeMap = new Map<string, GEdge>()
  ;(base.edges || []).forEach(e => {
    if (!e.id) return
    edgeMap.set(e.id, e)
  })
  ;(incoming.edges || []).forEach(e => {
    if (!e.id) return
    const old = edgeMap.get(e.id)
    if (old) {
      // та же пара адресов — складываем суммы и оставляем свежий timestamp/hash
      edgeMap.set(e.id, {
        ...old,
        ...e,
        value: (old.value || 0) + (e.value || 0),
        txCount: (old.txCount || 0) + (e.txCount || 0),
        timestamp: Math.max(old.timestamp || 0, e.timestamp || 0),
        date: (e.timestamp || 0) >= (old.timestamp || 0) ? e.date : old.date,
        hash: (e.timestamp || 0) >= (old.timestamp || 0) ? e.hash : old.hash,
      })
    } else {
      edgeMap.set(e.id, e)
    }
  })

  // 4. Стат — максимально близко к смыслу «совокупности» обоих анализов.
  const bs = base.stats || {} as import('@/types').GraphStats
  const ns = incoming.stats || {} as import('@/types').GraphStats

  const mergedScore = Math.max(base.riskScore || 0, incoming.riskScore || 0)
  const mergedLevel =
    mergedScore >= 75 ? 'critical' :
    mergedScore >= 50 ? 'high' :
    mergedScore >= 25 ? 'medium' : 'low'

  return {
    ...incoming,
    center: newCenter,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    riskScore: mergedScore,
    riskLevel: mergedLevel,
    riskFactors: incoming.riskFactors?.length ? incoming.riskFactors : base.riskFactors,
    stats: {
      ...ns,
      analyzedTx: (bs.analyzedTx || 0) + (ns.analyzedTx || 0),
      uniqueCounterparties: Math.max(0, nodeMap.size - 1),
      totalVolume: roundTo((bs.totalVolume || 0) + (ns.totalVolume || 0), 8),
      incomingTx: (bs.incomingTx || 0) + (ns.incomingTx || 0),
      outgoingTx: (bs.outgoingTx || 0) + (ns.outgoingTx || 0),
      inVolume: roundTo((bs.inVolume || 0) + (ns.inVolume || 0), 8),
      outVolume: roundTo((bs.outVolume || 0) + (ns.outVolume || 0), 8),
      firstActivity: minNonZero(bs.firstActivity, ns.firstActivity),
      lastActivity: Math.max(bs.lastActivity || 0, ns.lastActivity || 0),
    },
  }
}

function minNonZero(a?: number, b?: number) {
  const A = a || 0, B = b || 0
  if (!A) return B
  if (!B) return A
  return Math.min(A, B)
}

// Сборка мульти-графа по кэшу: проходим по trail (порядок анализа)
// и последовательно мерджим. После сборки помечает все «звенья» цепочки
// chainIdx (порядковый номер), а рёбра между ними — chain-spine.
function buildMultiGraph(
  walletGraphs: Record<string, GraphResponse>,
  trail: TrailEntry[],
  currentAddr: string,
): GraphResponse | null {
  const ordered = trail
    .map(t => t.addr)
    .filter(a => walletGraphs[a])
  if (ordered.length === 0) return walletGraphs[currentAddr] || null
  if (ordered.length === 1) {
    const only = walletGraphs[ordered[0]]
    return tagChain({ ...only, center: currentAddr || ordered[0] }, [ordered[0]])
  }

  // Собираем по порядку trail; центром делаем currentAddr (последний выбранный).
  let acc: GraphResponse | null = null
  for (const addr of ordered) {
    const g = walletGraphs[addr]
    if (!g) continue
    if (!acc) {
      acc = JSON.parse(JSON.stringify(g))
      continue
    }
    acc = mergeGraphData(acc, g, addr)
  }
  if (!acc) return null

  // финальная «промывка» — гарантируем, что центром виден текущий адрес
  if (currentAddr && currentAddr !== acc.center) {
    acc = mergeGraphData(acc, walletGraphs[currentAddr] || acc, currentAddr)
  }

  return tagChain(acc, ordered)
}

// Помечает кошельки цепочки порядковым chainIdx, выставляет isAnalyzed
// и isChainSpine для рёбер между парами анализированных узлов.
function tagChain(graph: GraphResponse, ordered: string[]): GraphResponse {
  const idxMap = new Map(ordered.map((a, i) => [a, i]))
  const isChain = (id: string) => idxMap.has(id)

  const nodes = graph.nodes.map(n => ({
    ...n,
    chainIdx: idxMap.has(n.id) ? idxMap.get(n.id) : undefined,
    isAnalyzed: idxMap.has(n.id) ? n.id !== graph.center : !!n.isAnalyzed,
    isCenter: n.id === graph.center,
  }))

  const edges = graph.edges.map(e => {
    const sid = typeof e.source === 'object' ? (e.source as any).id : (e.source as string)
    const tid = typeof e.target === 'object' ? (e.target as any).id : (e.target as string)
    return {
      ...e,
      isChainSpine: isChain(sid) && isChain(tid),
    } as any
  })

  return { ...graph, nodes, edges }
}

function roundTo(v: number, d: number) { return parseFloat(v.toFixed(d)) }

export const useStore = create<ForensicsState>((set, get) => ({
  mergedGraph: null,
  currentAddr: '',
  currentChain: 'bitcoin',
  loading: false,
  is3D: true,
  maxNodes: 300,
  multiMode: false,
  analyzedAddresses: new Set(),
  walletTrail: [],
  walletGraphs: {},
  navHistory: [],
  navIdx: -1,
  navSkipSave: false,
  selectedNode: null,
  txSheetOpen: false,
  txSheetFilter: '',
  txSheetSearch: '',
  txSheetSort: 'date-desc',
  txDetailOpen: false,
  txDetailHash: '',
  txDetailDir: '',
  txDetailCounterparty: '',
  txDetailAmount: 0,
  settingsOpen: false,
  toasts: [],
  txStep: parseInt(localStorage.getItem('forensics_tx_step') || '500') || 500,
  dateFrom: '',
  dateTo: '',
  viewAddr: '',

  setGraph: (g, addr, chain) => set(s => {
    const newAddrs = new Set(s.analyzedAddresses)
    newAddrs.add(addr)
    const trail = s.walletTrail.find(w => w.addr === addr)
      ? s.walletTrail
      : [...s.walletTrail, { addr, chain }]

    // Каждый отдельный анализ кладём в кэш как «сырой» граф (с owner-тегом).
    // Это позволяет потом восстанавливать мульти-граф в любое время.
    const taggedG = tagOwnership(JSON.parse(JSON.stringify(g)), addr)
    const walletGraphs = { ...s.walletGraphs, [addr]: taggedG }

    // Если мульти-режим активен — собираем граф по всему кэшу, иначе показываем
    // только текущий. При выключении режима пользователь видит чистый граф
    // конкретного адреса; при включении — снова склеенную «карту» цепочки.
    let mergedGraph: GraphResponse
    if (s.multiMode && Object.keys(walletGraphs).length > 1) {
      mergedGraph = buildMultiGraph(walletGraphs, trail, addr) || taggedG
    } else {
      mergedGraph = taggedG
    }

    const count = g.stats?.analyzedTx || 0
    try { localStorage.setItem('bf_txc_' + addr, String(count)) } catch {}

    return {
      mergedGraph,
      currentAddr: addr,
      currentChain: chain,
      analyzedAddresses: newAddrs,
      walletTrail: trail,
      walletGraphs,
      selectedNode: null,
      viewAddr: '',  // сброс — левая панель показывает текущий адрес
    }
  }),

  mergeGraph: (g, addr) => set(s => {
    // Дозагрузка для одного адреса — обновляем его кэш и пересобираем мульти-граф.
    const taggedG = tagOwnership(JSON.parse(JSON.stringify(g)), addr)
    const walletGraphs = { ...s.walletGraphs, [addr]: taggedG }
    try { localStorage.setItem('bf_txc_' + addr, String(g.stats?.analyzedTx || 0)) } catch {}
    const mergedGraph = s.multiMode && Object.keys(walletGraphs).length > 1
      ? (buildMultiGraph(walletGraphs, s.walletTrail, s.currentAddr || addr) || taggedG)
      : taggedG
    return { walletGraphs, mergedGraph }
  }),

  clearGraph: () => {
    try { sessionStorage.removeItem('bf_session_v1') } catch {}
    set({
      mergedGraph: null, currentAddr: '', loading: false,
      analyzedAddresses: new Set(), walletTrail: [],
      walletGraphs: {},
      selectedNode: null, txSheetOpen: false, viewAddr: '',
    })
  },

  setLoading: (v) => set({ loading: v }),
  toggle3D: () => set(s => ({ is3D: !s.is3D })),
  setMaxNodes: (n) => set({ maxNodes: n }),

  // Переключение мульти-режима ВСЕГДА пересобирает граф из кэша:
  //   — ON  → объединяем все ранее проанализированные кошельки;
  //   — OFF → возвращаем чистый граф текущего адреса (или первый из кэша).
  toggleMultiMode: () => set(s => {
    const next = !s.multiMode
    let mergedGraph = s.mergedGraph
    const cacheSize = Object.keys(s.walletGraphs).length
    if (next && cacheSize > 1) {
      mergedGraph = buildMultiGraph(s.walletGraphs, s.walletTrail, s.currentAddr) || s.mergedGraph
    } else if (!next && s.currentAddr && s.walletGraphs[s.currentAddr]) {
      // Возвращаем «чистый» граф текущего адреса (с owner-тегом, без chainIdx).
      mergedGraph = s.walletGraphs[s.currentAddr]
    }
    return { multiMode: next, mergedGraph }
  }),

  setSelectedNode: (n) => set({ selectedNode: n }),
  openTxSheet: () => set({ txSheetOpen: true }),
  closeTxSheet: () => set({ txSheetOpen: false }),
  setTxSheetFilter: (f) => set({ txSheetFilter: f }),
  setTxSheetSearch: (s) => set({ txSheetSearch: s }),
  setTxSheetSort: (s) => set({ txSheetSort: s }),

  openTxDetail: (hash, dir, counterparty, amount) =>
    set({ txDetailOpen: true, txDetailHash: hash, txDetailDir: dir, txDetailCounterparty: counterparty, txDetailAmount: amount }),
  closeTxDetail: () => set({ txDetailOpen: false, txDetailHash: '' }),

  toggleSettings: () => set(s => ({ settingsOpen: !s.settingsOpen })),

  addToast: (msg, type, duration = 3000) => {
    const id = String(++toastCounter)
    set(s => ({ toasts: [...s.toasts, { id, message: msg, type, duration }] }))
    setTimeout(() => get().removeToast(id), duration + 500)
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

  setTxStep: (n) => {
    try { localStorage.setItem('forensics_tx_step', String(n)) } catch {}
    set({ txStep: n })
  },

  setDateFilter: (from, to) => set({ dateFrom: from, dateTo: to }),

  setViewAddr: (addr) => set({ viewAddr: addr }),

  navSave: () => set(s => {
    if (s.navSkipSave || !s.mergedGraph) return {}
    const entry: NavEntry = {
      addr: s.currentAddr,
      chain: s.currentChain,
      maxTx: s.txStep,
      multiMode: s.multiMode,
      graphSnapshot: JSON.parse(JSON.stringify(s.mergedGraph)),
      analyzedAddresses: [...s.analyzedAddresses],
      walletTrail: JSON.parse(JSON.stringify(s.walletTrail)),
    }
    let hist = s.navHistory.slice(0, s.navIdx + 1)
    hist.push(entry)
    if (hist.length > NAV_MAX) hist = hist.slice(hist.length - NAV_MAX)
    return { navHistory: hist, navIdx: hist.length - 1 }
  }),

  navBack: () => {
    const s = get()
    if (s.navIdx <= 0) return
    const newIdx = s.navIdx - 1
    set({ navIdx: newIdx, navSkipSave: true })
    get().navRestore(s.navHistory[newIdx])
    setTimeout(() => set({ navSkipSave: false }), 100)
  },

  navForward: () => {
    const s = get()
    if (s.navIdx >= s.navHistory.length - 1) return
    const newIdx = s.navIdx + 1
    set({ navIdx: newIdx, navSkipSave: true })
    get().navRestore(s.navHistory[newIdx])
    setTimeout(() => set({ navSkipSave: false }), 100)
  },

  navRestore: (entry) => set({
    mergedGraph: JSON.parse(JSON.stringify(entry.graphSnapshot)),
    currentAddr: entry.addr,
    currentChain: entry.chain,
    multiMode: entry.multiMode,
    analyzedAddresses: new Set(entry.analyzedAddresses),
    walletTrail: JSON.parse(JSON.stringify(entry.walletTrail)),
    txStep: entry.maxTx,
  }),
}))
