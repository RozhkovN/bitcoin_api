import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const BASE = import.meta.env.DEV ? '' : ''

type AuthState = {
  user: string | null
  loading: boolean
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/me`, { credentials: 'include' })
      const j = await res.json().catch(() => ({}))
      setUser(j?.ok && typeof j.user === 'string' ? j.user : null)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        return { ok: false as const, error: typeof j.error === 'string' ? j.error : 'Ошибка входа' }
      }
      setUser(typeof j.user === 'string' ? j.user : username)
      return { ok: true as const }
    } catch {
      return { ok: false as const, error: 'Сеть недоступна' }
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(`${BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' })
    } catch { /* ignore */ }
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, refresh, login, logout }),
    [user, loading, refresh, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
