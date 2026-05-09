import { useCallback, useRef } from 'react'
import { useStore } from '../store'
import { fetchGraph } from '../api'
import type { Chain } from '../types'
import { detectChain } from '../utils/format'

export function useForensics() {
  const abortRef = useRef<AbortController | null>(null)

  const analyze = useCallback(async (addr: string, chainHint: string = 'auto') => {
    if (!addr.trim()) return
    const trimmed = addr.trim()

    // Detect chain
    let chain: Chain = 'bitcoin'
    if (chainHint === 'btc') chain = 'bitcoin'
    else if (chainHint === 'eth') chain = 'ethereum'
    else {
      const detected = detectChain(trimmed)
      chain = detected || 'bitcoin'
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const store = useStore.getState()

    // How many TX to request initially — use previously saved count for this address
    const prevCount = (() => {
      try { return parseInt(localStorage.getItem('bf_txc_' + trimmed) || '0') || 0 } catch { return 0 }
    })()
    const want = Math.max(store.txStep, prevCount)

    // Сохраняем состояние ДО загрузки (чтобы Back вернул к предыдущему адресу)
    store.navSave()
    store.setLoading(true)

    try {
      const data = await fetchGraph(chain, trimmed, want, abortRef.current.signal)
      store.setGraph(data, trimmed, chain)

      // Save per-address TX count
      const count = data.stats?.analyzedTx || 0
      try { localStorage.setItem('bf_txc_' + trimmed, String(count)) } catch {}

      // Save to search history
      const history: Array<{ addr: string; chain: string; ts: number }> =
        JSON.parse(localStorage.getItem('bf_history') || '[]')
      const filtered = history.filter(h => h.addr !== trimmed)
      filtered.unshift({ addr: trimmed, chain, ts: Date.now() })
      try { localStorage.setItem('bf_history', JSON.stringify(filtered.slice(0, 30))) } catch {}

      store.addToast(`Загружено ${count} TX`, 'success')
    } catch (err: any) {
      if (err.name === 'AbortError') return
      store.addToast('Ошибка: ' + err.message, 'error', 4000)
    } finally {
      store.setLoading(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const store = useStore.getState()
    if (!store.currentAddr) return

    const alreadyHave = store.mergedGraph?.stats?.analyzedTx || 0
    const step = store.txStep
    const want = alreadyHave + step

    store.setLoading(true)
    try {
      const data = await fetchGraph(store.currentChain, store.currentAddr, want, abortRef.current.signal)
      const gotTx = data.stats?.analyzedTx || 0

      if (store.multiMode && store.analyzedAddresses.size > 1) {
        store.mergeGraph(data, store.currentAddr)
      } else {
        store.setGraph(data, store.currentAddr, store.currentChain)
      }

      try { localStorage.setItem('bf_txc_' + store.currentAddr, String(gotTx)) } catch {}

      const gained = gotTx - alreadyHave
      if (gained > 0) {
        store.addToast(`+${gained} TX загружено. Итого: ${gotTx}`, 'success')
      } else {
        store.addToast(`Итого ${gotTx} TX — больше нет`, 'info')
      }

      store.navSave()
    } catch (err: any) {
      if (err.name === 'AbortError') return
      store.addToast('Ошибка дозагрузки: ' + err.message, 'error', 4000)
    } finally {
      store.setLoading(false)
    }
  }, [])

  return { analyze, loadMore }
}
