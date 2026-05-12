export const shortAddr = (addr: string) =>
  addr && addr.length > 14 ? addr.slice(0, 6) + '…' + addr.slice(-4) : addr

export const fmt8 = (v: number) =>
  parseFloat(v.toFixed(8)).toLocaleString('ru', { minimumFractionDigits: 4, maximumFractionDigits: 8 })

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
