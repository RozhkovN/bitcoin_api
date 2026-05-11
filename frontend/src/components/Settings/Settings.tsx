import { useStore } from '../../store'
import styles from './Settings.module.css'

interface GraphSettings {
  particles: boolean
  arrows: boolean
  glow: boolean
  bg: boolean
}

interface Props {
  settings: GraphSettings
  onChange: (key: keyof GraphSettings, val: boolean) => void
  onLogout?: () => void
}

export default function Settings({ settings, onChange, onLogout }: Props) {
  const { settingsOpen, toggleSettings } = useStore()

  if (!settingsOpen) return null

  return (
    <>
      <div className={styles.backdrop} onClick={toggleSettings} />
      <div className={styles.panel}>
        <div className={styles.title}>Настройки графа</div>
        <SettingRow label="Частицы на рёбрах" value={settings.particles} onChange={v => onChange('particles', v)} />
        <SettingRow label="Стрелки направлений" value={settings.arrows} onChange={v => onChange('arrows', v)} />
        <SettingRow label="Свечение узлов" value={settings.glow} onChange={v => onChange('glow', v)} />
        <SettingRow label="Анимация фона" value={settings.bg} onChange={v => onChange('bg', v)} />
        {onLogout ? (
          <>
            <div className={styles.divider} />
            <button type="button" className={styles.logoutBtn} onClick={() => { onLogout(); toggleSettings() }}>
              Выйти из аккаунта
            </button>
          </>
        ) : null}
      </div>
    </>
  )
}

function SettingRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div className={`${styles.toggle} ${value ? styles.on : ''}`} onClick={() => onChange(!value)} />
    </div>
  )
}
