import type { GraphResponse, MempoolTx } from '@/types'

const BASE = import.meta.env.DEV ? '' : ''

export async function fetchGraph(
  chain: 'bitcoin' | 'ethereum',
  address: string,
  maxTx: number,
  signal?: AbortSignal,
): Promise<GraphResponse> {
  const endpoint = chain === 'bitcoin' ? '/api/btc/graph' : '/api/eth/graph'
  const url = `${BASE}${endpoint}?address=${encodeURIComponent(address)}&maxTx=${maxTx}`
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export async function fetchTxDetail(txid: string): Promise<MempoolTx> {
  const res = await fetch(`https://mempool.space/api/tx/${txid}`)
  if (!res.ok) throw new Error(`Mempool error ${res.status}`)
  return res.json()
}

// ─── Trace ────────────────────────────────────────────────────────────────
export interface TraceIO {
  index: number
  addr: string
  value: number
  spent?: boolean
  spentBy?: string
  spentVin?: number
  prevTxid?: string
  prevVout?: number
}

export interface TraceNode {
  hash: string
  depth: number
  time: number
  confirmed: boolean
  blockHeight: number
  fee: number
  inputs: TraceIO[]
  outputs: TraceIO[]
  totalIn: number
  totalOut: number
  isCoinbase?: boolean
  isRoot?: boolean
  explorerUrl: string
}

export interface TraceEdge {
  from: string
  fromVout: number
  to: string
  toVin: number
  address: string
  value: number
}

export interface TraceResponse {
  chain: string
  root: string
  nodes: TraceNode[]
  edges: TraceEdge[]
  stats: {
    backward: number
    forward: number
    totalNodes: number
    totalEdges: number
    totalValue: number
    uniqueAddrs: number
    oldestTime: number
    newestTime: number
  }
  meta: {
    direction: string
    depth: number
    truncated: boolean
    cached?: boolean
    cacheAgeS?: number
  }
}

export async function fetchTrace(
  hash: string,
  depth = 5,
  direction: 'both' | 'forward' | 'backward' = 'both',
  signal?: AbortSignal,
): Promise<TraceResponse> {
  const url = `${BASE}/api/btc/trace?hash=${encodeURIComponent(hash)}&depth=${depth}&direction=${direction}`
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(`Trace API error ${res.status}: ${await res.text()}`)
  return res.json()
}
