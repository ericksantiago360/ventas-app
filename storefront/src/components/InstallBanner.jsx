import { useEffect, useState } from 'react'

// Ofrece instalar la tienda como app. Solo aparece si el navegador lo permite
// y el cliente no lo descartó antes.
export default function InstallBanner() {
  const [evento, setEvento] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const alLlegar = (e) => {
      e.preventDefault()
      setEvento(e)
      if (!localStorage.getItem('pwa-banner-dismissed')) setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', alLlegar)
    return () => window.removeEventListener('beforeinstallprompt', alLlegar)
  }, [])

  if (!visible) return null

  const instalar = async () => {
    if (evento) {
      evento.prompt()
      await evento.userChoice
    }
    setVisible(false)
  }

  const descartar = () => {
    localStorage.setItem('pwa-banner-dismissed', '1')
    setVisible(false)
  }

  return (
    <div role="dialog" aria-label="Instalar la tienda" style={{
      position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 999,
      background: '#0F1923', color: '#fff', borderRadius: 14, padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,.4)',
    }}>
      <span style={{ fontSize: 28 }} aria-hidden="true">📲</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '.95rem' }}>Instalar la tienda</div>
        <div style={{ fontSize: '.8rem', opacity: 0.8 }}>Accede más rápido desde tu pantalla de inicio</div>
      </div>
      <button onClick={instalar} style={{
        background: 'var(--brand)', border: 'none', color: '#fff', borderRadius: 8,
        padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: '.85rem',
      }}>Instalar</button>
      <button onClick={descartar} aria-label="Cerrar" style={{
        background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, opacity: 0.6,
      }}>✕</button>
    </div>
  )
}
