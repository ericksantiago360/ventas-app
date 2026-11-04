import { useEffect, useState } from 'react'
import axios from 'axios'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const dinero = (v) => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const formVacio = { nombre: '', ajuste_pct: '', categoria_id: '', redondear_pesos: false, descripcion: '' }

function mensajeError(err, fallback) {
  const detalle = err.response?.data?.detail
  if (Array.isArray(detalle)) return detalle.map(d => d.msg).join('. ') || fallback
  return detalle || fallback
}

// Listas de precios generadas desde el precio base de los productos con un ajuste
export default function ListasPrecios({ negocioId, categorias, onCerrar }) {
  const [listas, setListas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(formVacio)
  const [guardando, setGuardando] = useState(false)
  const [detalle, setDetalle] = useState(null) // { lista, data }

  const cargarListas = async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/api/catalogo/listas-precios', { params: { negocio_id: negocioId } })
      setListas(data?.data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar las listas.'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarListas() }, [negocioId])

  const verPrecios = async (lista) => {
    setError('')
    try {
      const { data } = await api.get(`/api/catalogo/listas-precios/${lista._id}/precios`, { params: { negocio_id: negocioId } })
      setDetalle({ lista: data.lista, data: data.data })
    } catch (err) {
      setError(mensajeError(err, 'No se pudo abrir la lista.'))
    }
  }

  const generar = async (e) => {
    e.preventDefault()
    setError('')
    const ajuste = Number(form.ajuste_pct)
    if (form.ajuste_pct === '' || Number.isNaN(ajuste)) { setError('Indica el ajuste en porcentaje (ej. -10 para descuento).'); return }
    setGuardando(true)
    try {
      await api.post('/api/catalogo/listas-precios/generar', {
        negocio_id: negocioId,
        nombre: form.nombre.trim(),
        ajuste_pct: ajuste,
        categoria_id: form.categoria_id || null,
        redondear_pesos: form.redondear_pesos,
        descripcion: form.descripcion.trim(),
      })
      setForm(formVacio)
      await cargarListas()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo generar la lista.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <h2 style={s.titulo}>{detalle ? `Precios: ${detalle.lista.nombre}` : 'Listas de precios'}</h2>
          <button onClick={onCerrar} style={s.cerrar}>×</button>
        </div>

        <div style={s.cuerpo}>
          {error && <div style={s.error}>{error}</div>}

          {detalle ? (
            <>
              <p style={s.muted}>
                Ajuste {detalle.lista.ajuste_pct}% sobre el precio base
                {detalle.lista.redondear_pesos ? ' · precios en pesos enteros' : ''}
                {detalle.lista.categoria_id ? ' · solo una categoría' : ''}
              </p>
              <div style={s.tabla}>
                <div style={{ ...s.fila, ...s.filaCabecera }}>
                  <span>Producto</span><span>Base</span><span>Lista</span><span>Diferencia</span>
                </div>
                {detalle.data.map(f => (
                  <div key={f.producto_id} style={s.fila}>
                    <span><strong>{f.nombre}</strong> <span style={s.muted}>{f.codigo}</span></span>
                    <span>{dinero(f.precio_base)}</span>
                    <span style={{ fontWeight: 700 }}>{dinero(f.precio)}</span>
                    <span style={{ color: f.diferencia_pct < 0 ? '#16a34a' : f.diferencia_pct > 0 ? '#b45309' : '#64748b' }}>
                      {f.diferencia_pct > 0 ? '+' : ''}{f.diferencia_pct}%
                    </span>
                  </div>
                ))}
              </div>
              <div style={s.pie}>
                <button onClick={() => setDetalle(null)} style={s.secundario}>← Volver a listas</button>
              </div>
            </>
          ) : (
            <>
              <form onSubmit={generar} style={s.form}>
                <h3 style={s.subtitulo}>Generar una lista nueva</h3>
                <div style={s.grid}>
                  <label style={s.campo}>
                    <span>Nombre *</span>
                    <input required value={form.nombre} placeholder="Ej. Mayoreo" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                  </label>
                  <label style={s.campo}>
                    <span>Ajuste sobre precio base (%) *</span>
                    <input required type="number" step="0.01" min={-99} max={500} value={form.ajuste_pct}
                      placeholder="-10 = 10% menos" onChange={e => setForm(f => ({ ...f, ajuste_pct: e.target.value }))} />
                  </label>
                  <label style={s.campo}>
                    <span>Categoría (opcional)</span>
                    <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))}>
                      <option value="">Todo el catálogo</option>
                      {categorias.map(c => <option key={c._id || c.id} value={c._id || c.id}>{c.nombre}</option>)}
                    </select>
                  </label>
                  <label style={{ ...s.campo, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={form.redondear_pesos} onChange={e => setForm(f => ({ ...f, redondear_pesos: e.target.checked }))} />
                    <span>Redondear a pesos enteros</span>
                  </label>
                </div>
                <div style={s.pie}>
                  <button type="submit" disabled={guardando} style={s.principal}>
                    {guardando ? 'Generando…' : 'Generar lista'}
                  </button>
                </div>
              </form>

              <h3 style={s.subtitulo}>Listas existentes</h3>
              {cargando ? <div style={s.muted}>Cargando…</div> : listas.length === 0 ? (
                <div style={s.muted}>Aún no hay listas de precios.</div>
              ) : (
                <div style={s.tabla}>
                  <div style={{ ...s.fila, ...s.filaCabecera }}>
                    <span>Nombre</span><span>Ajuste</span><span>Productos</span><span></span>
                  </div>
                  {listas.map(l => (
                    <div key={l._id} style={s.fila}>
                      <span><strong>{l.nombre}</strong></span>
                      <span>{l.generada ? `${l.ajuste_pct}%` : 'Manual'}</span>
                      <span>{l.total_productos ?? '—'}</span>
                      <span><button onClick={() => verPrecios(l)} style={s.secundario}>Ver precios</button></span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 },
  modal: { width: '100%', maxWidth: 780, maxHeight: '90vh', background: '#fff', borderRadius: 10, boxShadow: '0 20px 50px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid #e2e8f0' },
  titulo: { margin: 0, fontSize: 18, color: '#0f172a' },
  cerrar: { border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer', color: '#64748b' },
  cuerpo: { padding: 20, overflowY: 'auto' },
  subtitulo: { fontSize: 14, margin: '18px 0 10px', color: '#334155' },
  form: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: '#475569' },
  error: { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  muted: { color: '#64748b', fontSize: 13 },
  tabla: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  fila: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  filaCabecera: { background: '#f8fafc', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  pie: { display: 'flex', justifyContent: 'flex-end', marginTop: 14 },
  principal: { background: '#0f172a', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 16px', cursor: 'pointer', fontSize: 13 },
  secundario: { background: '#fff', border: '1px solid #cbd5e1', color: '#334155', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 12 },
}
