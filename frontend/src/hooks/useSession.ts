import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { GraphResponse, Chain, TrailEntry } from '../types'

const SESSION_KEY = 'bf_session_v1'

interface SessionData {
  graph: GraphResponse
  addr: string
  chain: Chain
  multiMode: boolean
  analyzedAddresses: string[]
  walletTrail: TrailEntry[]
  walletGraphs: Record<string, GraphResponse>
  txStep: number
  is3D: boolean
  maxNodes: number
  dateFrom: string
  dateTo: string
}

/**
 * Восстанавливает аналитический сеанс из sessionStorage.
 * Возвращает `restored = true`, если в стейте появился реальный граф,
 * чтобы родитель не запускал autoanalyze поверх восстановленных данных.
 */
export function useSession() {
  const [restored, setRestored] = useState(false)
  const restoredRef = useRef(false)

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return
      const session: SessionData = JSON.parse(raw)
      if (!session.graph || !session.addr) return
      if (!Array.isArray(session.graph.nodes) || session.graph.nodes.length === 0) return

      useStore.setState({
        mergedGraph: session.graph,
        currentAddr: session.addr,
        currentChain: session.chain,
        multiMode: !!session.multiMode,
        analyzedAddresses: new Set(session.analyzedAddresses || [session.addr]),
        walletTrail: session.walletTrail || [{ addr: session.addr, chain: session.chain }],
        walletGraphs: session.walletGraphs || { [session.addr]: session.graph },
        txStep: session.txStep || 500,
        is3D: typeof session.is3D === 'boolean' ? session.is3D : true,
        maxNodes: session.maxNodes || 300,
        dateFrom: session.dateFrom || '',
        dateTo: session.dateTo || '',
        selectedNode: null,
      })
      setRestored(true)
    } catch {}
  }, [])

  // Сохраняем сеанс на КАЖДОЕ значимое изменение стейта
  useEffect(() => {
    return useStore.subscribe((state) => {
      if (!state.mergedGraph || !state.currentAddr) return
      try {
        const session: SessionData = {
          graph: state.mergedGraph,
          addr: state.currentAddr,
          chain: state.currentChain,
          multiMode: state.multiMode,
          analyzedAddresses: [...state.analyzedAddresses],
          walletTrail: state.walletTrail,
          walletGraphs: state.walletGraphs,
          txStep: state.txStep,
          is3D: state.is3D,
          maxNodes: state.maxNodes,
          dateFrom: state.dateFrom,
          dateTo: state.dateTo,
        }
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      } catch {}
    })
  }, [])

  return restored
}

/** Полная очистка локального сеанса (для кнопки «На главную»). */
export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch {}
}
