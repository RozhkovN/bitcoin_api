export const shortAddr = (addr: string) =>
  addr && addr.length > 14 ? addr.slice(0, 6) + '…' + addr.slice(-4) : addr

export const fmt8 = (v: number) =>
  parseFloat(v.toFixed(8)).toLocaleString('ru', { minimumFractionDigits: 4, maximumFractionDigits: 8 })

// Compact crypto formatter — keeps the value readable inside narrow side panels.
//   1.23456789  → 1,2346
//   1234.56789  → 1 234,57
//   1234567.89  → 1,23M
//   1234567890  → 1,23B
export const fmtCompact = (v: number, decimals = 4) => {
  const n = Number(v) || 0
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toLocaleString('ru', { maximumFractionDigits: 2 }) + 'B'
  if (abs >= 1e6) return (n / 1e6).toLocaleString('ru', { maximumFractionDigits: 2 }) + 'M'
  if (abs >= 1e3) return n.toLocaleString('ru', { maximumFractionDigits: 2 })
  return parseFloat(n.toFixed(decimals)).toLocaleString('ru', {
    minimumFractionDigits: Math.min(decimals, 2),
    maximumFractionDigits: decimals,
  })
}

export const fmtDate = (ts: number) =>
  ts ? new Date(ts * 1000).toLocaleDateString('ru', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

export const fmtDateTime = (ts: number) =>
  ts ? new Date(ts * 1000).toLocaleString('ru', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : '—'

export const riskColor = (score: number) => {
  if (score >= 75) return '#f87171'
  if (score >= 50) return '#f59e0b'
  if (score >= 25) return '#facc15'
  return '#10b981'
}

export const riskLabel = (level: string) => {
  const map: Record<string, string> = { low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический' }
  return map[level] || level
}

export const detectChain = (addr: string): 'bitcoin' | 'ethereum' | null => {
  if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return 'ethereum'
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr)) return 'bitcoin'
  return null
}

// Точно как в оригинальном forensics.html: riskColor(n.riskScore)
// Пороги 20 / 45 / 70 дают хорошее визуальное распределение —
// при консервативном perNodeRisk большинство score 15-35 → medium (жёлтый),
// а score >= 45 → orange/red, что совпадает с ощущением "подозрительности".
export const nodeColor = (node: { isCenter?: boolean; isAnalyzed?: boolean; riskScore?: number; riskLevel?: string }) => {
  if (node.isCenter) return '#3b82f6'
  if (node.isAnalyzed) return '#06b6d4'
  const s = node.riskScore || 0
  if (s >= 70) return '#ef4444'  // critical (red)
  if (s >= 45) return '#f97316'  // high (orange)
  if (s >= 15) return '#f59e0b'  // medium (yellow)
  return '#10b981'               // low (green)
}

export const nodeSize = (node: { isCenter?: boolean; isAnalyzed?: boolean; txCount?: number; totalIn?: number; totalOut?: number }) => {
  if (node.isCenter) return 26
  if (node.isAnalyzed) return 16
  const volume = (node.totalIn || 0) + (node.totalOut || 0)
  const txFactor = Math.log10(Math.max(1, node.txCount || 1))
  const volFactor = Math.log10(Math.max(1, volume)) / 3
  return Math.min(14, Math.max(4, 4 + txFactor * 2 + volFactor))
}

export const filterGraphForRender = <T extends { nodes: any[]; edges: any[] }>(
  data: T,
  maxNodes: number,
): T => {
  if (!data || data.nodes.length <= maxNodes) return data
  const pinned = data.nodes.filter((n: any) => n.isCenter || n.isAnalyzed)
  const rest = data.nodes
    .filter((n: any) => !n.isCenter && !n.isAnalyzed)
    .sort((a: any, b: any) =>
      (b.txCount || 0) * ((b.totalIn || 0) + (b.totalOut || 0) + 1) -
      (a.txCount || 0) * ((a.totalIn || 0) + (a.totalOut || 0) + 1))
  const slots = Math.max(0, maxNodes - pinned.length)
  const kept = new Set([...pinned, ...rest.slice(0, slots)].map((n: any) => n.id))
  return {
    ...data,
    nodes: data.nodes.filter((n: any) => kept.has(n.id)),
    edges: data.edges.filter((e: any) => {
      const s = typeof e.source === 'object' ? e.source?.id : e.source
      const t = typeof e.target === 'object' ? e.target?.id : e.target
      return kept.has(s) && kept.has(t)
    }),
  }
}
