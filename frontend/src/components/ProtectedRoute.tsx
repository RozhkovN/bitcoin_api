import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg)',
          color: 'var(--text2)',
          fontSize: 13,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 22,
            height: 22,
            borderRadius: '50%',
            border: '2px solid rgba(59,130,246,0.35)',
            borderTopColor: '#3b82f6',
            animation: 'spin .75s linear infinite',
            marginRight: 12,
            verticalAlign: 'middle',
          }}
        />
        Проверка сессии…
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  return <>{children}</>
}
