import styles from './Landing.module.css'

export default function Landing({ visible }: { visible: boolean }) {
  return (
    <div className={`${styles.landing} ${!visible ? styles.out : ''}`}>
      <div className={styles.eyebrow}>AI Threat Intelligence</div>
      <div className={styles.hero}>
        <div className={styles.h1}>
          Blockchain<br /><span>Forensics</span>
        </div>
        <div className={styles.sub}>
          Введите адрес Bitcoin или Ethereum чтобы визуализировать граф транзакций и получить автоматическую оценку риска
        </div>
      </div>
      <div className={styles.chips}>
        <Chip icon={netIcon}>3D граф связей</Chip>
        <Chip icon={shieldIcon}>Risk Score</Chip>
        <Chip icon={waveIcon}>Flow-анализ</Chip>
        <Chip icon={searchIcon}>Трассировка</Chip>
        <Chip icon={dlIcon}>Экспорт</Chip>
      </div>
    </div>
  )
}

function Chip({ icon, children }: { icon: string; children: string }) {
  return (
    <div className={styles.chip}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: icon }} />
      {children}
    </div>
  )
}

const netIcon = `<circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><line x1="6" y1="6" x2="10" y2="11"/><line x1="18" y1="6" x2="14" y2="11"/><line x1="6" y1="18" x2="10" y2="13"/><line x1="18" y1="18" x2="14" y2="13"/>`
const shieldIcon = `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`
const waveIcon = `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`
const searchIcon = `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`
const dlIcon = `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`
