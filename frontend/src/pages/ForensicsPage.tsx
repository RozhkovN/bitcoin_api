import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'
import { useStore } from '../store'
import { useForensics } from '../hooks/useForensics'
import { useSession, clearSession } from '../hooks/useSession'
import { useKeyboard } from '../hooks/useKeyboard'

import TopBar from '../components/TopBar/TopBar'
import ControlBar from '../components/ControlBar/ControlBar'
import LeftPanel from '../components/LeftPanel/LeftPanel'
import GraphContainer, { GraphHandle } from '../components/Graph/GraphContainer'
import NodeDetails from '../components/RightPanel/NodeDetails'
import TxSheet from '../components/TxSheet/TxSheet'
import TxDetailModal from '../components/TxDetail/TxDetailModal'
import Legend from '../components/Legend/Legend'
import StatusBar from '../components/StatusBar/StatusBar'
import GraphControls from '../components/GraphControls/GraphControls'
import Landing from '../components/Landing/Landing'
import Toast from '../components/Toast/Toast'
import CmdPalette from '../components/CmdPalette/CmdPalette'
import Settings from '../components/Settings/Settings'

import type { GraphNode } from '../types'

interface GraphSettings {
  particles: boolean
  arrows: boolean
  glow: boolean
  bg: boolean
}

export default function ForensicsPage() {
  const {
    mergedGraph, loading, selectedNode,
    setSelectedNode, clearGraph,
  } = useStore()

  const { analyze, loadMore } = useForensics()
  const graphRef = useRef<GraphHandle>(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [graphSettings, setGraphSettings] = useState<GraphSettings>({
    particles: true, arrows: true, glow: true, bg: true,
  })

  // Lock body scroll synchronously before first paint — MUST be useLayoutEffect,
  // not useEffect, so the CSS applies before the graph measures its container.
  useLayoutEffect(() => {
    document.body.classList.add('forensics-mode')
    return () => document.body.classList.remove('forensics-mode')
  }, [])

  // Восстановление сессии должно произойти ДО auto-analyze, чтобы при F5
  // на странице форензики не сбрасывался мульти-режим / multi-graph.
  const sessionRestored = useSession()

  // Обработка URL `?address=…`:
  //   1) URL без параметров → доверяем сессии (или показываем Landing).
  //   2) URL с параметром, совпадающим с сессией → просто чистим query.
  //   3) URL с другим адресом → ЯВНЫЙ запрос нового анализа: чистим сессию,
  //      сбрасываем стор и запускаем analyze().
  // После любой обработки query-часть удаляем, чтобы F5 не дёргал analyze повторно.
  useEffect(() => {
    const url = new URL(window.location.href)
    const param = url.searchParams.get('address')
    if (!param) return

    const chainParam = url.searchParams.get('chain')
    const chain = chainParam === 'eth' || chainParam === 'btc'
      ? chainParam
      : (/^0x[a-fA-F0-9]{40}$/.test(param.trim()) ? 'eth' : 'btc')

    const cleanUrl = () => {
      url.searchParams.delete('address')
      url.searchParams.delete('chain')
      window.history.replaceState({}, '', url.pathname + (url.search || '') + url.hash)
    }

    const sessionAddr = useStore.getState().currentAddr
    if (sessionRestored && sessionAddr === param.trim()) {
      cleanUrl()
      return
    }

    // Новый адрес → начинаем чистый анализ
    if (sessionRestored && sessionAddr && sessionAddr !== param.trim()) {
      clearSession()
      useStore.getState().clearGraph()
    }
    analyze(param.trim(), chain)
    cleanUrl()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRestored])

  // Keyboard shortcuts
  const focusSearch = useCallback(() => {
    document.querySelector<HTMLInputElement>('.addrInput, [data-search-input]')?.focus()
  }, [])
  useKeyboard(() => setCmdOpen(true), focusSearch)

  // Background hex canvas
  useEffect(() => {
    const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const hexes: Array<{ x: number; y: number; opacity: number; speed: number }> = []
    const size = 28
    const cols = Math.ceil(window.innerWidth / (size * 1.75)) + 2
    const rows = Math.ceil(window.innerHeight / (size * 1.5)) + 2
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        hexes.push({
          x: c * size * 1.75 + (r % 2 ? size * 0.875 : 0),
          y: r * size * 1.5,
          opacity: Math.random() * 0.04,
          speed: (Math.random() * 0.3 + 0.05) * (Math.random() < 0.5 ? 1 : -1),
        })
      }
    }

    const drawHex = (x: number, y: number, s: number) => {
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6
        const px = x + s * Math.cos(angle)
        const py = y + s * Math.sin(angle)
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!graphSettings.bg) { animId = requestAnimationFrame(draw); return }
      hexes.forEach(h => {
        h.opacity += h.speed * 0.001
        if (h.opacity > 0.06 || h.opacity < 0) h.speed *= -1
        drawHex(h.x, h.y, size - 2)
        ctx.strokeStyle = `rgba(59,130,246,${Math.max(0, h.opacity)})`
        ctx.lineWidth = 0.5
        ctx.stroke()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
    }
  }, [graphSettings.bg])

  const handleAnalyze = useCallback(async (addr: string, chain: string) => {
    // navSave вызывается внутри analyze() — не дублируем
    await analyze(addr, chain)
  }, [analyze])

  const handleLoadMore = useCallback(async () => {
    setEnriching(true)
    try { await loadMore() } finally { setEnriching(false) }
  }, [loadMore])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node)
  }, [setSelectedNode])

  const handleExploreNode = useCallback((addr: string, chain: string) => {
    setSelectedNode(null)
    // Нормализуем chain: 'bitcoin'→'btc', 'ethereum'→'eth'
    const hint = chain === 'ethereum' ? 'eth' : chain === 'bitcoin' ? 'btc' : 'auto'
    handleAnalyze(addr, hint)
  }, [handleAnalyze, setSelectedNode])

  const handleFocusNode = useCallback((addr: string) => {
    graphRef.current?.focusNode(addr)
  }, [])

  const handleSettingChange = useCallback((key: keyof GraphSettings, val: boolean) => {
    setGraphSettings(prev => ({ ...prev, [key]: val }))
  }, [])

  const hasGraph = !!mergedGraph

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', zIndex: 1 }}>
      {/* Background */}
      <canvas id="bg-canvas" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }} />
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
          top: -200, left: -100,
          animation: 'aMove 18s ease-in-out infinite alternate',
        }} />
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%)',
          bottom: -150, right: -50,
          animation: 'aMove2 22s ease-in-out infinite alternate',
        }} />
      </div>

      {/* Toasts */}
      <Toast />

      {/* Command Palette */}
      <CmdPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAnalyze={handleAnalyze} />

      {/* Settings */}
      <Settings settings={graphSettings} onChange={handleSettingChange} />

      {/* TopBar */}
      <TopBar onAnalyze={handleAnalyze} onOpenCmd={() => setCmdOpen(true)} />

      {/* Control Bar */}
      <ControlBar
        onLoadMore={handleLoadMore}
        onFocusNode={handleFocusNode}
        onAnalyze={handleAnalyze}
        enriching={enriching}
      />

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24,
          background: 'rgba(5,8,16,0.88)', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', position: 'relative' }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '2px solid transparent', borderTopColor: 'var(--accent)', borderRightColor: 'rgba(59,130,246,0.4)',
              animation: 'spin 0.9s linear infinite',
            }} />
          </div>
          <div style={{ color: 'var(--text2)', fontSize: 14 }}>Анализирую…</div>
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', zIndex: 1 }}>
        {/* Left panel */}
        <LeftPanel onNodeSelect={addr => {
          const node = mergedGraph?.nodes?.find(n => n.fullAddress === addr || n.id === addr)
          if (node) { setSelectedNode(node); graphRef.current?.focusNode(addr) }
        }} />

        {/* Graph area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Landing screen */}
          <Landing visible={!hasGraph && !loading} />

          {/* Force graph */}
          <GraphContainer
            ref={graphRef}
            onNodeClick={handleNodeClick}
            settings={{
              particles: graphSettings.particles,
              arrows: graphSettings.arrows,
              glow: graphSettings.glow,
            }}
          />

          {/* Legend */}
          <Legend />

          {/* Hint */}
          {hasGraph && (
            <div id="hint" className="visible" style={{
              position: 'absolute',
              bottom: 72,
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: 10,
              color: 'var(--text3)',
              background: 'rgba(5,8,16,0.78)',
              backdropFilter: 'blur(8px)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '5px 10px',
              zIndex: 10,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>
              ЛКМ — выбрать узел &nbsp;·&nbsp; ПКМ — контекст &nbsp;·&nbsp; Колесо — масштаб &nbsp;·&nbsp; Перетащить — панорама
            </div>
          )}

          {/* Graph controls */}
          <GraphControls
            onReset={() => graphRef.current?.resetCamera()}
            onZoomIn={() => graphRef.current?.zoomIn()}
            onZoomOut={() => graphRef.current?.zoomOut()}
            onCenter={() => graphRef.current?.focusCenter()}
          />

          {/* Status bar */}
          <StatusBar />
        </div>

        {/* Right panel (node details) */}
        <NodeDetails
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExplore={handleExploreNode}
          graphEdges={mergedGraph?.edges || []}
        />
      </div>

      {/* TX Sheet */}
      <TxSheet />

      {/* TX Detail Modal */}
      <TxDetailModal />

      {/* Global animations */}
      <style>{`
        @keyframes aMove { 0%{transform:translate(0,0) scale(1);} 100%{transform:translate(120px,80px) scale(1.3);} }
        @keyframes aMove2 { 0%{transform:translate(0,0) scale(1);} 100%{transform:translate(-80px,-60px) scale(1.2);} }
        @keyframes spin { to { transform: rotate(360deg); } }
        .tt-chain { display:inline-block;font-size:9px;font-weight:600;padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px; }
        .tt-chain.btc { background:rgba(245,158,11,.15);color:#f59e0b; }
        .tt-chain.eth { background:rgba(139,92,246,.15);color:#8b5cf6; }
        .tt-addr { font-family:var(--mono);font-size:10.5px;color:var(--text2);margin-bottom:8px;word-break:break-all; }
        .tt-row { display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:2px 0; }
        .tt-k { color:var(--text3); }
        .tt-v { font-weight:500;color:var(--text); }
        .tt-risk-bar { height:3px;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden;margin-top:8px; }
        .tt-risk-fill { height:100%;border-radius:99px;transition:width .3s; }
        #tooltip.show { opacity: 1 !important; }
        .gc-btn:hover { background: var(--glass2) !important; color: var(--text) !important; border-color: var(--border2) !important; }
      `}</style>
    </div>
  )
}
