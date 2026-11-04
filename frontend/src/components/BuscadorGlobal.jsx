import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// Búsqueda en todos los módulos del negocio activo. Ctrl/⌘ + K enfoca el cuadro; Esc lo cierra.
export default function BuscadorGlobal({ negocioId }) {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const contenedor = useRef(null)
  const entrada = useRef(null)

  useEffect(() => {
    const q = texto.trim()
    if (q.length < 2 || !negocioId) {
      setResultados([])
      setError('')
      setBuscando(false)
      return
    }
    let cancelado = false
    setBuscando(true)
    const espera = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/buscar', { params: { negocio_id: negocioId, q } })
        if (!cancelado) { setResultados(data); setError('') }
      } catch (err) {
        if (!cancelado) {
          setResultados([])
          setError(err.response?.data?.detail?.[0]?.msg || err.response?.data?.detail || 'No se pudo buscar.')
        }
      } finally {
        if (!cancelado) setBuscando(false)
      }
    }, 250)
    return () => { cancelado = true; clearTimeout(espera) }
  }, [texto, negocioId])

  useEffect(() => {
    const atajo = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        entrada.current?.focus()
        setAbierto(true)
      }
      if (e.key === 'Escape') {
        setAbierto(false)
        entrada.current?.blur()
      }
    }
    const fueraDelCuadro = (e) => {
      if (contenedor.current && !contenedor.current.contains(e.target)) setAbierto(false)
    }
    document.addEventListener('keydown', atajo)
    document.addEventListener('mousedown', fueraDelCuadro)
    return () => {
      document.removeEventListener('keydown', atajo)
      document.removeEventListener('mousedown', fueraDelCuadro)
    }
  }, [])

  const ir = (r) => {
    setTexto('')
    setAbierto(false)
    navigate(r.ruta)
  }

  const grupos = resultados.reduce((mapa, r) => {
    (mapa[r.tipo] = mapa[r.tipo] || []).push(r)
    return mapa
  }, {})

  const mostrarPanel = abierto && texto.trim().length >= 2

  return (
    <div ref={contenedor} style={{ position: 'relative', maxWidth: 560, marginBottom: 18 }}>
      <input
        ref={entrada}
        value={texto}
        onChange={e => { setTexto(e.target.value); setAbierto(true) }}
        onFocus={() => setAbierto(true)}
        placeholder="Buscar clientes, productos, pedidos, órdenes…  (Ctrl K)"
        aria-label="Buscar en la aplicación"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 14px', border: '1px solid #cbd5e1',
          borderRadius: 8, fontSize: 14, background: '#fff', outline: 'none',
        }}
      />

      {mostrarPanel && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 950,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(15,23,42,.12)', maxHeight: 420, overflowY: 'auto',
        }}>
          {error && <div style={{ padding: 14, color: '#b91c1c', fontSize: 13 }}>{error}</div>}
          {!error && !buscando && resultados.length === 0 && (
            <div style={{ padding: 14, color: '#64748b', fontSize: 13 }}>Sin resultados para "{texto.trim()}".</div>
          )}
          {buscando && resultados.length === 0 && (
            <div style={{ padding: 14, color: '#94a3b8', fontSize: 13 }}>Buscando…</div>
          )}
          {Object.entries(grupos).map(([tipo, items]) => (
            <div key={tipo}>
              <div style={{ padding: '8px 14px 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {tipo}
              </div>
              {items.map(r => (
                <button
                  key={`${r.tipo}-${r.id}`}
                  onClick={() => ir(r)}
                  style={{
                    display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    background: 'none', border: 'none', padding: '8px 14px', cursor: 'pointer', textAlign: 'left',
                    fontSize: 13, color: '#334155',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                >
                  <span style={{ fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.titulo}</span>
                  {r.subtitulo && <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>{r.subtitulo}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
