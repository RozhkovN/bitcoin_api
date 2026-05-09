import { useEffect } from 'react'
import { useStore } from '../store'

export function useKeyboard(
  onOpenCmd: () => void,
  onAnalyze: () => void,
) {
  const { navBack, navForward, toggleSettings } = useStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd/Ctrl+K → command palette
      if (meta && e.key === 'k') {
        e.preventDefault()
        onOpenCmd()
        return
      }
      // Cmd/Ctrl+, → settings
      if (meta && e.key === ',') {
        e.preventDefault()
        toggleSettings()
        return
      }
      // Escape
      if (e.key === 'Escape') {
        const s = useStore.getState()
        if (s.settingsOpen) { toggleSettings(); return }
        if (s.txDetailOpen) { s.closeTxDetail(); return }
        if (s.txSheetOpen) { s.closeTxSheet(); return }
        if (s.selectedNode) { s.setSelectedNode(null); return }
        return
      }
      // Alt+← / Alt+→ navigation history
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navBack(); return }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navForward(); return }

      // Slash → focus search
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        onAnalyze()
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navBack, navForward, toggleSettings, onOpenCmd, onAnalyze])
}
