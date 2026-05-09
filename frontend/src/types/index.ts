// ─── Graph API types ──────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  label: string
  fullAddress: string
  isCenter: boolean
  isAnalyzed?: boolean
  type: string
  riskScore: number
  riskLevel: string
  txCount: number
  totalIn: number
  totalOut: number
  netFlow: number
  firstSeen: number
  lastSeen: number
  // мульти-режим: к какому анализированному кошельку «принадлежит» узел
  // (используется для seed-расположения counterparty около его центра)
  ownerAddr?: string
  // позиция в trail (0,1,2,…). Заполняется только для анализированных узлов
  chainIdx?: number
  // internal (added by force-graph)
  x?: number; y?: number; z?: number
  vx?: number; vy?: number; vz?: number
  fx?: number; fy?: number; fz?: number
}

export interface GraphEdgeExt {
  isChainSpine?: boolean   // true для рёбер между двумя анализированными узлами цепочки
}

export interface GraphEdge {
  id: string
  source: string | GraphNode
  target: string | GraphNode
  value: number
  txCount: number
  timestamp: number
  date: string
  direction: 'in' | 'out' | ''
  hash: string
}

export interface RiskFactor {
  name: string
  score: number
  detail: string
}

export interface GraphStats {
  uniqueCounterparties: number
  totalVolume: number
  avgTxValue: number
  analyzedTx: number
  incomingTx: number
  outgoingTx: number
  inVolume: number
  outVolume: number
  firstActivity: number
  lastActivity: number
  firstActivityDate: string
  lastActivityDate: string
}

export interface GraphResponse {
  chain: string
  center: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: GraphStats
  riskScore: number
  riskLevel: string
  riskFactors: RiskFactor[]
}

// ─── Wallet summary ───────────────────────────────────────────────────────────

export interface BtcSummaryResponse {
  chain: string
  address: string
  nTx: number
  balance: number
  totalReceived: number
  totalSent: number
}

// ─── TX detail (from mempool.space) ──────────────────────────────────────────

export interface MempoolVout {
  scriptpubkey_address?: string
  value: number
}

export interface MempoolVin {
  txid?: string
  is_coinbase?: boolean
  prevout?: MempoolVout
}

export interface MempoolTxStatus {
  confirmed: boolean
  block_height?: number
  block_hash?: string
  block_time?: number
}

export interface MempoolTx {
  txid: string
  version: number
  fee: number
  size: number
  weight: number
  locktime: number
  vin: MempoolVin[]
  vout: MempoolVout[]
  status: MempoolTxStatus
}

// ─── UI state types ───────────────────────────────────────────────────────────

export type Chain = 'bitcoin' | 'ethereum'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface TrailEntry {
  addr: string
  chain: Chain
}

export interface NavEntry {
  addr: string
  chain: Chain
  maxTx: number
  multiMode: boolean
  graphSnapshot: GraphResponse
  analyzedAddresses: string[]
  walletTrail: TrailEntry[]
}

export interface TxRow {
  dir: 'in' | 'out'
  fullAddr: string
  label: string
  amount: number
  txCount: number
  timestamp: number
  date: string
  hash: string
  riskScore: number
  isAnalyzed: boolean
}

export type ToastType = 'success' | 'error' | 'info' | 'warn'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
}
