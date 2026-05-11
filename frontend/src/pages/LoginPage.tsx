import { useState, FormEvent, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from || '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!loading && user) navigate(from, { replace: true })
  }, [loading, user, from, navigate])

  if (loading) {
    return (
      <div className={styles.root} style={{ color: 'var(--text2)', fontSize: 13 }}>
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await login(username.trim(), password)
      if (!r.ok) {
        setErr(r.error || 'Ошибка')
        return
      }
      navigate(from, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.mesh}>
        <div className={styles.blob1} />
        <div className={styles.blob2} />
        <div className={styles.blob3} />
      </div>
      <div className={styles.grid} />

      <div className={styles.card}>
        <div className={styles.ring} aria-hidden />
        <div className={styles.eyebrow}>Secure access</div>
        <h1 className={styles.title}>
          Blockchain<br /><span>Forensics</span>
        </h1>
        <p className={styles.sub}>
          Войдите, чтобы продолжить работу с аналитикой и графом транзакций
        </p>

        <form onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="bf-login-user">Логин</label>
            <input
              id="bf-login-user"
              className={styles.input}
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Имя пользователя"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="bf-login-pass">Пароль</label>
            <input
              id="bf-login-pass"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••••••••"
            />
          </div>
          <button className={styles.submit} type="submit" disabled={busy || !username.trim() || !password}>
            {busy ? 'Вход…' : 'Войти'}
          </button>
        </form>

        {err ? <div className={styles.err} role="alert">{err}</div> : null}

        <p className={styles.hint}>
          Сессия сохраняется в защищённой cookie на этом устройстве.
        </p>
      </div>
    </div>
  )
}
