import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import HomePage from './pages/HomePage'
import TracePage from './pages/TracePage'
import LoginPage from './pages/LoginPage'

export default function App() {
  useEffect(() => {
    const tip = document.createElement('div')
    tip.id = 'g-tip'
    tip.style.cssText = `
      position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
      background:rgba(5,8,16,0.97);backdrop-filter:blur(16px);
      border:1px solid rgba(255,255,255,0.14);border-radius:8px;
      padding:6px 12px;font-size:11px;color:#e2e8f0;z-index:99999;
      pointer-events:none;opacity:0;transition:opacity .15s;white-space:nowrap;
    `
    document.body.appendChild(tip)

    const show = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null
      if (target?.dataset.tip) {
        tip.textContent = target.dataset.tip
        tip.style.opacity = '1'
      } else {
        tip.style.opacity = '0'
      }
    }
    const hide = () => { tip.style.opacity = '0' }

    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', hide)
    document.addEventListener('click', hide)
    document.addEventListener('scroll', hide, true)
    window.addEventListener('popstate', hide)
    return () => {
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', hide)
      document.removeEventListener('click', hide)
      document.removeEventListener('scroll', hide, true)
      window.removeEventListener('popstate', hide)
      document.body.removeChild(tip)
    }
  }, [])

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trace"
            element={
              <ProtectedRoute>
                <TracePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
