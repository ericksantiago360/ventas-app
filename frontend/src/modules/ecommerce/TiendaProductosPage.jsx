import { useEffect, useState } from 'react'
import { useNegocio } from '../../context/NegocioContext'
import { req, qs, s } from './comun'

// Qué categorías del catálogo interno se ven en la tienda. Sin selección = todas.
export default function TiendaProductosPage() {
  const { negocioId } = useNegocio()
  const [categorias, setCategorias] = useState([])
  const [seleccion, setSeleccion] = useState(new Set())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    if (!negocioId) return
    setCargando(true); setError(''); setMensaje('')
    Promise.all([
      req(`/api/admin/tienda/categorias?${qs({ negocio_id: negocioId })}`),
      req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`),
    ])
      .then(([cat, cfg]) => {
        setCategorias(cat.data)
        setSeleccion(new Set(cfg.categorias_visibles || []))
      })
      .catch(e => setError(e.message))
      .finally(() => setCargando(false))
  }, [negocioId])

  const alternar = (id) => setSeleccion(prev => {
    const nueva = new Set(prev)
    nueva.has(id) ? nueva.delete(id) : nueva.add(id)
    return nueva
  })

  const guardar = async () => {
    setGuardando(true); setError(''); setMensaje('')
    try {
      await req(`/api/admin/tienda/config?${qs({ negocio_id: negocioId })}`, {
        method: 'PUT', body: JSON.stringify({ categorias_visibles: [...seleccion] }),
      })
      setMensaje('Categorías guardadas')
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Productos en la tienda</h1>
        <button style={s.btn()} onClick={guardar} disabled={guardando || cargando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
        Elige las categorías del catálogo que se muestran al público. Si no eliges ninguna, se muestran todas.
        Los productos se editan en Catálogo; aquí solo decides qué se publica.
      </div>

      {error && <div style={{ ...s.err, marginTop: 14 }}>{error}</div>}
      {mensaje && <div style={{ background: '#dcfce7', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginTop: 14 }}>{mensaje}</div>}

      <div style={{ ...s.card, marginTop: 16 }}>
        {cargando && <div style={{ color: '#64748b' }}>Cargando…</div>}
        {!cargando && categorias.length === 0 && (
          <div style={{ color: '#64748b' }}>Este negocio aún no tiene categorías. Créalas en Catálogo.</div>
        )}
        {categorias.map(c => (
          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={seleccion.has(c.id)} onChange={() => alternar(c.id)} />
            {c.nombre}
          </label>
        ))}
      </div>
    </div>
  )
}
