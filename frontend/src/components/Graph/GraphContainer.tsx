import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useStore } from '../../store'
import { nodeColor, nodeSize, filterGraphForRender, riskColor, shortAddr } from '../../utils/format'
import type { GraphNode } from '../../types'

// Хелпер: канвас → CanvasTexture → Sprite с подписью адреса под узлом.
// Спрайт всегда смотрит на камеру, что идеально для меток в 3D.
function makeTextSprite(THREE: any, text: string, fg: string, bg: string) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const fontSize = 30
  ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  const padX = 12, padY = 6
  const m = ctx.measureText(text)
  canvas.width = Math.ceil(m.width + padX * 2)
  canvas.height = fontSize + padY * 2 + 6
  // повторно — после resize canvas сбрасывает контекст
  ctx.font = `600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
  // фон-пилюля
  const r = 10
  ctx.fillStyle = bg + 'cc'
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(canvas.width - r, 0)
  ctx.quadraticCurveTo(canvas.width, 0, canvas.width, r)
  ctx.lineTo(canvas.width, canvas.height - r)
  ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - r, canvas.height)
  ctx.lineTo(r, canvas.height)
  ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - r)
  ctx.lineTo(0, r)
  ctx.quadraticCurveTo(0, 0, r, 0)
  ctx.closePath()
  ctx.fill()
  // текст
  ctx.fillStyle = fg
  ctx.textBaseline = 'middle'
  ctx.fillText(text, padX, canvas.height / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(mat)
  // масштабируем спрайт пропорционально размеру канвы (1px ≈ 0.4 world units)
  const k = 0.45
  sprite.scale.set(canvas.width * k, canvas.height * k, 1)
  return sprite
}

export interface GraphHandle {
  focusNode: (addr: string) => void
  resetCamera: () => void
  zoomIn: () => void
  zoomOut: () => void
  focusCenter: () => void
}

export interface GraphSettings {
  particles: boolean
  arrows: boolean
  glow: boolean
}

interface Props {
  onNodeClick: (node: GraphNode) => void
  onNodeRightClick?: (node: GraphNode, event: MouseEvent) => void
  settings?: GraphSettings
}

const DEFAULT_SETTINGS: GraphSettings = { particles: true, arrows: true, glow: true }
const SHOW_NODE_LABELS = false
const SHOW_NODE_BADGES = false

const GraphContainer = forwardRef<GraphHandle, Props>(
  ({ onNodeClick, onNodeRightClick, settings = DEFAULT_SETTINGS }, ref) => {
    const { mergedGraph, is3D, maxNodes, dateFrom, dateTo, currentChain, walletTrail } = useStore()
    const containerRef = useRef<HTMLDivElement>(null)
    const graph3dRef = useRef<any>(null)
    const graph2dRef = useRef<any>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)
    const pendingDataRef = useRef<any>(null)
    const initGraphRef = useRef<(data: any) => void>(() => {})
    const runIdRef = useRef(0)
    // Latest settings as ref so node/link accessors always see fresh values without re-init.
    const settingsRef = useRef(settings)
    settingsRef.current = settings

    const getFilteredData = useCallback(() => {
      if (!mergedGraph) return null
      let data = mergedGraph
      if (dateFrom || dateTo) {
        const fromTs = dateFrom ? new Date(dateFrom).getTime() / 1000 : 0
        const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() / 1000 : Infinity
        const edges = (data.edges || []).filter((e: any) =>
          (!fromTs || !e.timestamp || e.timestamp >= fromTs) &&
          (!toTs || !e.timestamp || e.timestamp <= toTs),
        )
        const visIds = new Set(edges.flatMap((e: any) => [
          typeof e.source === 'object' ? e.source.id : e.source,
          typeof e.target === 'object' ? e.target.id : e.target,
        ]))
        const nodes = (data.nodes || []).filter((n: any) => n.isCenter || n.isAnalyzed || visIds.has(n.id))
        data = { ...data, nodes, edges }
      }
      return filterGraphForRender(data, maxNodes)
    }, [mergedGraph, maxNodes, dateFrom, dateTo])

    const showTooltip = useCallback((node: GraphNode, x: number, y: number) => {
      const tip = tooltipRef.current
      if (!tip) return
      const chain = currentChain === 'ethereum' ? 'ETH' : 'BTC'
      const chainCls = currentChain === 'ethereum' ? 'eth' : 'btc'
      tip.innerHTML = `
        <span class="tt-chain ${chainCls}">${chain}</span>
        <div class="tt-addr">${shortAddr(node.fullAddress || node.id)}</div>
        <div class="tt-row"><span class="tt-k">TX</span><span class="tt-v">${node.txCount || 0}</span></div>
        <div class="tt-row"><span class="tt-k">Входящих</span><span class="tt-v">${(node.totalIn || 0).toFixed(4)}</span></div>
        <div class="tt-row"><span class="tt-k">Исходящих</span><span class="tt-v">${(node.totalOut || 0).toFixed(4)}</span></div>
        <div class="tt-row"><span class="tt-k">Риск</span><span class="tt-v" style="color:${riskColor(node.riskScore || 0)}">${node.riskScore || 0}</span></div>
        <div class="tt-risk-bar"><div class="tt-risk-fill" style="width:${node.riskScore || 0}%;background:${riskColor(node.riskScore || 0)}"></div></div>
      `
      tip.style.left = `${x + 12}px`
      tip.style.top = `${y - 10}px`
      tip.classList.add('show')
    }, [currentChain])

    const hideTooltip = useCallback(() => {
      tooltipRef.current?.classList.remove('show')
    }, [])

    const flatLinks = (edges: any[]) => edges.map((e: any) => ({
      ...e,
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target,
    }))

    // ─── Multi-mode chain layout ─────────────────────────────────────────────
    // Распределяет анализированные кошельки по горизонтальной оси, чтобы каждый
    // выглядел как отдельный «граф-облачко» с собственными контрагентами.
    // Возвращает true, если применили chain-layout (>=2 анализированных).
    const applyChainLayout = (data: any, mode3d: boolean): boolean => {
      const chainNodes = (data.nodes || [])
        .filter((n: any) => typeof n.chainIdx === 'number')
        .sort((a: any, b: any) => a.chainIdx - b.chainIdx)
      const N = chainNodes.length
      if (N < 2) {
        // одиночный режим — снимаем фиксации, если они были
        ;(data.nodes || []).forEach((n: any) => {
          n.fx = undefined; n.fy = undefined; n.fz = undefined
        })
        return false
      }

      // Расстояние между «островами» подбираем под количество звеньев
      const spacing = Math.max(280, 220 + N * 30)
      const totalSpan = (N - 1) * spacing

      // Анализированные пинуем в линию по X. Y оставляем 0, Z=0 (3D).
      chainNodes.forEach((n: any, i: number) => {
        n.fx = -totalSpan / 2 + i * spacing
        n.fy = 0
        if (mode3d) n.fz = 0
        else n.fz = undefined
      })

      // Контрагенты получают seed-позицию вокруг своего owner'а — это
      // визуально образует отдельный «бублик» вокруг каждого анализированного.
      const ownerById = new Map<string, any>(chainNodes.map((c: any) => [c.id, c]))
      ;(data.nodes || []).forEach((n: any) => {
        if (typeof n.chainIdx === 'number') return
        // снимаем возможные старые pin'ы у обычных узлов
        n.fx = undefined; n.fy = undefined; n.fz = undefined
        const owner = ownerById.get(n.ownerAddr) || chainNodes[Math.min(N - 1, n.chainIdx ?? 0)]
        if (!owner) return
        const radius = 60 + Math.random() * 100
        const angle = Math.random() * Math.PI * 2
        // seed только если у узла ещё нет позиции (или она у origin)
        const noPos = n.x === undefined || (n.x === 0 && n.y === 0)
        if (noPos) {
          n.x = (owner.fx || 0) + radius * Math.cos(angle)
          n.y = radius * Math.sin(angle) * 0.6
          if (mode3d) n.z = (Math.random() - 0.5) * 80
        }
      })
      return true
    }

    // Цвет для звена цепочки (chainIdx = 0,1,2,…):
    // плавный переход cyan → mint → emerald → teal — каждый граф «своего» оттенка.
    const chainHue = (idx: number): string => {
      const palette = ['#06b6d4', '#0ea5e9', '#22d3ee', '#14b8a6', '#10b981', '#84cc16']
      return palette[idx % palette.length]
    }
    const colorForNode = (n: any) => {
      if (n.isCenter) return '#3b82f6'
      if (typeof n.chainIdx === 'number') return chainHue(n.chainIdx)
      return nodeColor(n)
    }
    const colorForLink = (l: any) => {
      if (l.isChainSpine) return 'rgba(96,165,250,0.85)'
      const dir = l.direction || ''
      return dir === 'in' ? 'rgba(16,185,129,0.45)' : dir === 'out' ? 'rgba(248,113,113,0.45)' : 'rgba(148,163,184,0.18)'
    }
    const widthForLink = (l: any) =>
      l.isChainSpine
        ? 3.2
        : Math.log10(Math.max(1, l.value || 0)) * 0.4 + 0.3

    const destroyGraphs = useCallback(() => {
      try { graph3dRef.current?._destructor?.() } catch {}
      try { graph2dRef.current?._destructor?.() } catch {}
      graph3dRef.current = null
      graph2dRef.current = null
      if (containerRef.current) containerRef.current.innerHTML = ''
    }, [])

    // Hot data update — preserves current node positions & camera state.
    // Mutates existing node objects in place so x,y,z,vx,vy,vz survive,
    // letting the simulation continue smoothly instead of restarting.
    const updateGraphData = useCallback((data: any) => {
      const target = graph3dRef.current || graph2dRef.current
      if (!target) return false
      const cur = target.graphData() as { nodes: any[]; links: any[] }
      const prevCount = cur.nodes.length
      const idx = new Map(cur.nodes.map((n: any) => [n.id, n]))

      let addedFresh = 0
      const nextNodes = (data.nodes || []).map((n: any) => {
        const existing = idx.get(n.id)
        if (existing) {
          // Mutate to preserve simulation state (x,y,z,vx,vy,vz,index)
          const { x, y, z, vx, vy, vz, fx, fy, fz, index } = existing
          Object.assign(existing, n)
          if (x !== undefined) existing.x = x
          if (y !== undefined) existing.y = y
          if (z !== undefined) existing.z = z
          if (vx !== undefined) existing.vx = vx
          if (vy !== undefined) existing.vy = vy
          if (vz !== undefined) existing.vz = vz
          if (fx !== undefined) existing.fx = fx
          if (fy !== undefined) existing.fy = fy
          if (fz !== undefined) existing.fz = fz
          if (index !== undefined) existing.index = index
          return existing
        }
        addedFresh++
        return { ...n }
      })
      const nextLinks = flatLinks(data.edges || [])

      // Применяем chain-layout к ВСЕМ узлам (и старым, и новым).
      // Это перепинит анализированных и сидит новых counterparties у их owner'а.
      const isChainLayout = applyChainLayout({ nodes: nextNodes, edges: nextLinks }, !!graph3dRef.current)

      target.graphData({ nodes: nextNodes, links: nextLinks })

      // Подкручиваем силы при появлении/исчезновении цепочки, чтобы кластеры
      // не схлопывались в общий центр.
      try {
        if (isChainLayout) {
          target.d3Force?.('center', null)
          const charge = target.d3Force?.('charge')
          charge?.strength?.(graph3dRef.current ? -90 : -110)
          const link = target.d3Force?.('link')
          link?.distance?.(graph3dRef.current ? 28 : 30)?.strength?.(0.85)
        }
      } catch {}

      // Когда подмешали новые узлы — реанимируем симуляцию и подгоняем камеру.
      if (addedFresh > 0 || nextNodes.length !== prevCount || isChainLayout) {
        try { target.d3ReheatSimulation?.() } catch {}
        const t = target
        setTimeout(() => { try { t.zoomToFit?.(700, 60) } catch {} }, 900)
        setTimeout(() => { try { t.zoomToFit?.(700, 60) } catch {} }, 2400)
      }

      return true
    }, [])

    const initGraph = useCallback(async (data: any) => {
      if (!containerRef.current || !data) return
      const runId = ++runIdRef.current
      destroyGraphs()

      const nodes = (data.nodes || []).map((n: any) => ({ ...n }))
      const links = flatLinks(data.edges || [])
      // Раскладываем цепочку (если >=2 анализированных) и сидим counterparties
      const isChainLayout = applyChainLayout({ nodes, edges: links }, is3D)
      const graphData = { nodes, links }

      const stale = () => runId !== runIdRef.current || !containerRef.current

      if (is3D) {
        const mod = await import('3d-force-graph')
        if (stale()) return
        const ForceGraph3D = (mod.default || mod) as any
        const THREE = await import('three')
        if (stale()) return

        // Orbit controls keep the camera locked on the graph centroid:
        // LMB rotates around the target, wheel zooms. Panning is disabled
        // so the camera can never drift "off" the graph.
        const g = ForceGraph3D({
          rendererConfig: { antialias: true, alpha: true },
          controlType: 'orbit',
        })(containerRef.current)
          .backgroundColor('rgba(0,0,0,0)')
          .width(containerRef.current.offsetWidth)
          .height(containerRef.current.offsetHeight)
          .graphData(graphData)
          .nodeColor((n: any) => colorForNode(n))
          .nodeVal((n: any) => Math.pow(nodeSize(n), 2))
          .nodeLabel(() => '')
          .nodeThreeObject((n: any) => {
            const color = colorForNode(n)
            const size = nodeSize(n)
            // Корневой 3D-объект (Group) — мы навешиваем на него mesh + glow + sprite-метку.
            const group = new THREE.Group()

            // Основное тело узла
            const geo = new THREE.SphereGeometry(size, 18, 18)
            const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.95 })
            const mesh = new THREE.Mesh(geo, mat)
            group.add(mesh)

            // Glow-ореол (увеличиваем у анализированных и центра, чтобы было сразу видно)
            if (settingsRef.current.glow || n.isCenter || n.isAnalyzed) {
              const glowMul = n.isCenter ? 2.2 : n.isAnalyzed ? 1.9 : 1.55
              const glowOp = n.isCenter ? 0.22 : n.isAnalyzed ? 0.18 : 0.12
              const glowGeo = new THREE.SphereGeometry(size * glowMul, 18, 18)
              const glowMat = new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: glowOp, side: THREE.BackSide,
                depthWrite: false,
              })
              group.add(new THREE.Mesh(glowGeo, glowMat))
            }

            // Подписи отключены по запросу — иначе перекрывают граф.
            if (SHOW_NODE_LABELS && (n.isCenter || n.isAnalyzed || typeof n.chainIdx === 'number')) {
              const label = (n.label || shortAddr(n.fullAddress || n.id || ''))
              const sprite = makeTextSprite(THREE, label, n.isCenter ? '#dbeafe' : '#a7f3d0', n.isCenter ? '#1e3a8a' : '#0f3a2c')
              sprite.position.set(0, -size - 11, 0)
              group.add(sprite)
            }

            // Badge-метка (MIXER / TRANSIT / DUST / HIGH-VOL / FREQUENT)
            if (SHOW_NODE_BADGES && n.badge) {
              const badgeColors: Record<string, [string, string]> = {
                MIXER:    ['#fef3c7', '#92400e'],
                TRANSIT:  ['#e0f2fe', '#075985'],
                DUST:     ['#fce7f3', '#9d174d'],
                'HIGH-VOL': ['#fef9c3', '#713f12'],
                FREQUENT: ['#f0fdf4', '#14532d'],
              }
              const [fg, bg] = badgeColors[n.badge] || ['#f1f5f9', '#1e293b']
              const badgeSprite = makeTextSprite(THREE, n.badge, fg, bg)
              badgeSprite.position.set(0, size + 10, 0)
              group.add(badgeSprite)
            }

            return group
          })
          .linkColor((l: any) => colorForLink(l))
          .linkWidth((l: any) => widthForLink(l))
          .linkDirectionalParticles((l: any) =>
            l.isChainSpine
              ? 4
              : settingsRef.current.particles ? Math.min(3, Math.max(1, l.txCount || 1)) : 0,
          )
          .linkDirectionalParticleSpeed((l: any) => l.isChainSpine ? 0.012 : 0.005)
          .linkDirectionalParticleWidth((l: any) => l.isChainSpine ? 3 : 1.5)
          .linkDirectionalParticleColor((l: any) => {
            if (l.isChainSpine) return '#60a5fa'
            const dir = l.direction || ''
            return dir === 'in' ? '#10b981' : dir === 'out' ? '#f87171' : '#94a3b8'
          })
          .linkDirectionalArrowLength((l: any) => l.isChainSpine ? 6 : (settingsRef.current.arrows ? 4 : 0))
          .linkDirectionalArrowRelPos(1)
          .onNodeClick((n: any) => onNodeClick(n as GraphNode))
          .onNodeRightClick((n: any, e: MouseEvent) => onNodeRightClick?.(n as GraphNode, e))
          .onNodeHover((n: any, _prev: any, e: any) => {
            if (n && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect()
              const ev = e as MouseEvent
              showTooltip(n, (ev?.clientX || 0) - rect.left, (ev?.clientY || 0) - rect.top)
            } else {
              hideTooltip()
            }
            if (containerRef.current) containerRef.current.style.cursor = n ? 'pointer' : 'default'
          })

        graph3dRef.current = g
        // Lock orbit target to origin and disable panning to prevent camera drift.
        try {
          const ctrls = g.controls() as any
          if (ctrls) {
            ctrls.enablePan = false
            ctrls.enableDamping = true
            ctrls.dampingFactor = 0.1
            ctrls.rotateSpeed = 0.85
            ctrls.zoomSpeed = 0.9
            if (ctrls.target?.set) ctrls.target.set(0, 0, 0)
          }
        } catch {}

        // Кастомные силы для мульти-режима: отключаем глобальный «центр»,
        // чтобы каждый граф-облачко группировался вокруг СВОЕГО анализированного,
        // а не стягивался в общую кучу. Усиливаем repel + ослабляем link.
        try {
          if (isChainLayout) {
            g.d3Force?.('center', null)
            const charge = g.d3Force?.('charge')
            charge?.strength?.(-90)
            const link = g.d3Force?.('link')
            link?.distance?.(28)?.strength?.(0.85)
          } else {
            const charge = g.d3Force?.('charge')
            charge?.strength?.(-50)
          }
        } catch {}

        // Камера: для цепочки немного отъезжаем, чтобы влезли все звенья.
        const camZ = isChainLayout ? 480 + (data.nodes?.filter((n: any) => typeof n.chainIdx === 'number').length || 0) * 60 : 380
        g.cameraPosition({ x: 0, y: 0, z: camZ }, { x: 0, y: 0, z: 0 })

        // Auto-fit the camera once the force simulation settles.
        // onEngineStop fires after the initial tick burst; one-shot flag prevents
        // re-triggering on every subsequent interaction that restarts the engine.
        let fitted3d = false
        try {
          g.onEngineStop(() => {
            if (!fitted3d) {
              fitted3d = true
              try { g.zoomToFit?.(800, 60) } catch {}
            }
          })
        } catch {}
        // Fallback: force a fit after 3 s even if onEngineStop never fires.
        setTimeout(() => {
          if (!fitted3d) { fitted3d = true; try { g.zoomToFit?.(800, 60) } catch {} }
        }, 3000)
      } else {
        const mod = await import('force-graph')
        if (stale()) return
        const ForceGraph2D = (mod.default || mod) as any

        const g = ForceGraph2D()(containerRef.current)
          .backgroundColor('rgba(0,0,0,0)')
          .width(containerRef.current.offsetWidth)
          .height(containerRef.current.offsetHeight)
          .graphData(graphData)
          .nodeLabel(() => '')
          .nodeCanvasObject((n: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const size = nodeSize(n)
            const color = colorForNode(n)
            const isPin = n.isCenter || n.isAnalyzed || typeof n.chainIdx === 'number'

            // Glow для всех (более яркий — для анализированных)
            if (settingsRef.current.glow || isPin) {
              const glowR = size * (isPin ? 3.4 : 2.4)
              const grd = ctx.createRadialGradient(n.x!, n.y!, 0, n.x!, n.y!, glowR)
              grd.addColorStop(0, color + (isPin ? '40' : '26'))
              grd.addColorStop(1, 'rgba(0,0,0,0)')
              ctx.beginPath(); ctx.arc(n.x!, n.y!, glowR, 0, Math.PI * 2)
              ctx.fillStyle = grd; ctx.fill()
            }

            // Тело узла
            ctx.beginPath(); ctx.arc(n.x!, n.y!, size, 0, Math.PI * 2)
            ctx.fillStyle = color; ctx.fill()

            // Кольцо для pin-узлов
            if (isPin) {
              ctx.strokeStyle = n.isCenter ? '#60a5fa' : '#22d3ee'
              ctx.lineWidth = n.isCenter ? 2.4 : 1.8
              ctx.stroke()
            }

            // Подписи отключены по запросу — иначе перекрывают граф.
            if (SHOW_NODE_LABELS && isPin) {
              const label = (n.label || shortAddr(n.fullAddress || n.id || ''))
              const fontSize = Math.max(11 / globalScale, 4)
              ctx.font = `600 ${fontSize}px ui-monospace, Menlo, monospace`
              const tw = ctx.measureText(label).width
              const padX = 4 / globalScale, padY = 2 / globalScale
              const ty = n.y! + size + fontSize + padY * 3
              ctx.fillStyle = 'rgba(5,8,16,0.85)'
              ctx.fillRect(n.x! - tw / 2 - padX, ty - fontSize - padY, tw + padX * 2, fontSize + padY * 2)
              ctx.fillStyle = n.isCenter ? '#dbeafe' : '#a7f3d0'
              ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
              ctx.fillText(label, n.x!, ty - padY)
            }

            // Бейджи отключены по запросу — иначе дают визуальный шум.
            if (SHOW_NODE_BADGES && n.badge && globalScale > 0.5) {
              const badgePalette: Record<string, [string, string]> = {
                MIXER:    ['#fef3c7', '#78350f'],
                TRANSIT:  ['#e0f2fe', '#0369a1'],
                DUST:     ['#fce7f3', '#831843'],
                'HIGH-VOL': ['#fef9c3', '#713f12'],
                FREQUENT: ['#dcfce7', '#14532d'],
              }
              const [fg2, bg2] = badgePalette[n.badge] || ['#f1f5f9', '#1e293b']
              const bFont = Math.max(8 / globalScale, 3)
              ctx.font = `700 ${bFont}px ui-sans-serif, system-ui`
              const bw = ctx.measureText(n.badge).width
              const bpx = 3 / globalScale, bpy = 1.5 / globalScale
              const bx = n.x! - bw / 2 - bpx, by = n.y! - size - bFont - bpy * 3
              const br = bpy * 2
              // Pill background
              ctx.fillStyle = bg2 + 'dd'
              ctx.beginPath()
              ctx.roundRect?.(bx, by, bw + bpx * 2, bFont + bpy * 2, br)
              ctx.fill()
              ctx.fillStyle = fg2
              ctx.textAlign = 'center'; ctx.textBaseline = 'top'
              ctx.fillText(n.badge, n.x!, by + bpy)
            }
          })
          .nodeCanvasObjectMode(() => 'replace' as const)
          .linkColor((l: any) => colorForLink(l))
          .linkWidth((l: any) => widthForLink(l))
          .linkDirectionalArrowLength((l: any) => l.isChainSpine ? 5 : (settingsRef.current.arrows ? 3 : 0))
          .linkDirectionalArrowRelPos(1)
          .linkDirectionalParticles((l: any) =>
            l.isChainSpine ? 3 : (settingsRef.current.particles ? Math.min(2, Math.max(0, l.txCount || 0)) : 0),
          )
          .linkDirectionalParticleSpeed((l: any) => l.isChainSpine ? 0.013 : 0.006)
          .linkDirectionalParticleWidth((l: any) => l.isChainSpine ? 3 : 2)
          .linkDirectionalParticleColor((l: any) => l.isChainSpine ? '#60a5fa' : '#94a3b8')
          .onNodeClick((n: any) => onNodeClick(n as GraphNode))
          .onNodeRightClick((n: any, e: MouseEvent) => onNodeRightClick?.(n as GraphNode, e))
          .onNodeHover((n: any, _prev: any, e: any) => {
            if (n && containerRef.current && e) {
              const rect = containerRef.current.getBoundingClientRect()
              showTooltip(n, (e.clientX || 0) - rect.left, (e.clientY || 0) - rect.top)
            } else {
              hideTooltip()
            }
            if (containerRef.current) containerRef.current.style.cursor = n ? 'pointer' : 'default'
          })

        graph2dRef.current = g
        try {
          if (isChainLayout) {
            g.d3Force?.('center', null)
            const charge = g.d3Force?.('charge')
            charge?.strength?.(-110)
            const link = g.d3Force?.('link')
            link?.distance?.(30)?.strength?.(0.9)
          }
        } catch {}
        setTimeout(() => g.zoomToFit(400, 40), 1200)
      }
    }, [is3D, onNodeClick, onNodeRightClick, showTooltip, hideTooltip, destroyGraphs])

    useEffect(() => {
      initGraphRef.current = initGraph
    })

    // Repaint accessors on settings change (no re-init, no scatter).
    useEffect(() => {
      const g3 = graph3dRef.current
      if (g3) {
        g3.linkDirectionalParticles((l: any) =>
          settingsRef.current.particles ? Math.min(3, Math.max(1, l.txCount || 1)) : 0,
        )
        g3.linkDirectionalArrowLength(() => (settingsRef.current.arrows ? 4 : 0))
        g3.refresh?.()
      }
      const g2 = graph2dRef.current
      if (g2) {
        g2.linkDirectionalArrowLength(() => (settingsRef.current.arrows ? 3 : 0))
        g2.linkDirectionalParticles((l: any) =>
          settingsRef.current.particles ? Math.min(2, Math.max(0, l.txCount || 0)) : 0,
        )
      }
    }, [settings.particles, settings.arrows, settings.glow])

    // Data / mode change. is3D & maxNodes need a full re-init; data alone is hot-updated.
    // walletTrail.length — при добавлении нового кошелька в мульти-режиме
    // форсируем полный reinit, чтобы 3d-force-graph правильно удалил старые меши
    // и пересчитал раскладку с нуля (иначе A-кластер остаётся на месте, а B
    // появляется вдалеке, создавая длинный «хвост»).
    const reinitKeys = `${is3D}|${maxNodes}|${dateFrom}|${dateTo}|${walletTrail.length}`
    const lastReinitKeys = useRef(reinitKeys)

    useEffect(() => {
      const data = getFilteredData()
      if (!data) {
        destroyGraphs()
        pendingDataRef.current = null
        return
      }

      const el = containerRef.current
      const hasSize = el && el.offsetWidth > 0 && el.offsetHeight > 0
      if (!hasSize) {
        pendingDataRef.current = data
        return
      }
      pendingDataRef.current = null

      const needFullReinit =
        lastReinitKeys.current !== reinitKeys ||
        (!graph3dRef.current && !graph2dRef.current)
      lastReinitKeys.current = reinitKeys

      if (needFullReinit) {
        initGraph(data)
      } else {
        // Hot path: incremental data update without scattering existing nodes.
        if (!updateGraphData(data)) initGraph(data)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mergedGraph, is3D, maxNodes, dateFrom, dateTo, walletTrail.length, getFilteredData, initGraph, destroyGraphs, updateGraphData, reinitKeys])

    useEffect(() => {
      const el = containerRef.current
      if (!el) return

      const ro = new ResizeObserver(() => {
        const w = el.offsetWidth
        const h = el.offsetHeight
        if (w === 0 || h === 0) return

        if (graph3dRef.current || graph2dRef.current) {
          graph3dRef.current?.width?.(w)?.height?.(h)
          graph2dRef.current?.width?.(w)?.height?.(h)
        } else if (pendingDataRef.current) {
          const data = pendingDataRef.current
          pendingDataRef.current = null
          initGraphRef.current(data)
        }
      })

      ro.observe(el)
      return () => ro.disconnect()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useImperativeHandle(ref, () => ({
      focusNode(addr: string) {
        const g3 = graph3dRef.current
        const g2 = graph2dRef.current
        const cur = (g3 || g2)?.graphData?.()
        const node = cur?.nodes?.find((n: any) => n.fullAddress === addr || n.id === addr)
        if (!node) return
        if (g3) {
          // Move camera so the target is the node, keeping the original distance.
          const cam = g3.cameraPosition()
          const dist = Math.hypot(cam.x - (node.x || 0), cam.y - (node.y || 0), cam.z - (node.z || 0)) || 380
          const off = dist
          g3.cameraPosition(
            { x: (node.x || 0), y: (node.y || 0), z: (node.z || 0) + off },
            { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
            700,
          )
          try { g3.controls()?.target?.set?.(node.x || 0, node.y || 0, node.z || 0) } catch {}
        }
        g2?.centerAt?.(node.x || 0, node.y || 0, 500)
        g2?.zoom?.(Math.max(g2.zoom?.() || 1, 2.4), 500)
      },
      resetCamera() {
        graph3dRef.current?.cameraPosition?.({ x: 0, y: 0, z: 380 }, { x: 0, y: 0, z: 0 }, 600)
        try { graph3dRef.current?.controls()?.target?.set?.(0, 0, 0) } catch {}
        graph2dRef.current?.zoomToFit?.(400, 40)
      },
      zoomIn() {
        if (graph3dRef.current) {
          const p = graph3dRef.current.cameraPosition()
          graph3dRef.current.cameraPosition({ x: p.x, y: p.y, z: p.z * 0.7 }, undefined as any, 300)
        }
        if (graph2dRef.current) graph2dRef.current.zoom(graph2dRef.current.zoom() * 1.3, 300)
      },
      zoomOut() {
        if (graph3dRef.current) {
          const p = graph3dRef.current.cameraPosition()
          graph3dRef.current.cameraPosition({ x: p.x, y: p.y, z: p.z * 1.4 }, undefined as any, 300)
        }
        if (graph2dRef.current) graph2dRef.current.zoom(graph2dRef.current.zoom() * 0.75, 300)
      },
      focusCenter() {
        const g3 = graph3dRef.current
        const g2 = graph2dRef.current
        const cur = (g3 || g2)?.graphData?.()
        const center = cur?.nodes?.find((n: any) => n.isCenter)
        if (!center) return
        if (g3) {
          g3.cameraPosition(
            { x: center.x || 0, y: center.y || 0, z: (center.z || 0) + 380 },
            { x: center.x || 0, y: center.y || 0, z: center.z || 0 },
            700,
          )
          try { g3.controls()?.target?.set?.(center.x || 0, center.y || 0, center.z || 0) } catch {}
        }
        g2?.centerAt?.(center.x || 0, center.y || 0, 600)
        g2?.zoom?.(Math.max(g2?.zoom?.() || 1, 2.4), 600)
      },
    }), [])

    return (
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        <div
          ref={tooltipRef}
          id="tooltip"
          style={{
            position: 'absolute',
            zIndex: 200,
            pointerEvents: 'none',
            background: 'rgba(5,8,16,0.97)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10,
            padding: '12px 14px',
            minWidth: 190,
            maxWidth: 260,
            opacity: 0,
          }}
        />
      </div>
    )
  },
)

export default GraphContainer
