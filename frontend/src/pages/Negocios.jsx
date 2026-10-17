import { useState } from 'react'
import { negociosApi } from '../api/client'
import { useNegocio } from '../context/NegocioContext'

const GIROS = [
  ['distribucion',        'Distribución'],
  ['fabricacion_cnc',     'Fabricación'],
  ['inmobiliario',        'Inmobiliaria'],
  ['laboratorio_clinico', 'Laboratorio clínico'],
  ['servicios',           'Servicios'],
  ['otro',                'Otro'],
]
const NOMBRE_GIRO = Object.fromEntries(GIROS)

const VACIO = { nombre: '', id: '', prefijo: '', tipo: 'otro' }

// "Dulce Tentación" → "dulce_tentacion"
const sugerirId = (nombre) =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 40)

// "Dulce Tentación" → "DT"; "Ferretería" → "FER"
const sugerirPrefijo = (nombre) => {
  const palabras = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .split(/[^A-Z0-9]+/).filter(Boolean)
  const iniciales = palabras.map(p => p[0]).join('').slice(0, 4)
  return iniciales.length >= 2 ? iniciales : (palabras[0] || '').slice(0, 3)
}

export default function Negocios() {
  const { negociosDisponibles, negocioId, recargarNegocios } = useNegocio()
  const esAdmin = JSON.parse(localStorage.getItem('user') || '{}').rol === 'admin'

  const [form, setForm] = useState(VACIO)
  // Mientras el usuario no edite id o prefijo a mano, se sugieren a partir del nombre
  const [editado, setEditado] = useState({ id: false, prefijo: false })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  function cambiarNombre(nombre) {
    setForm(f => ({
      ...f,
      nombre,
      id:      editado.id      ? f.id      : sugerirId(nombre),
      prefijo: editado.prefijo ? f.prefijo : sugerirPrefijo(nombre),
    }))
  }

  async function crear(ev) {
    ev.preventDefault()
    setGuardando(true); setError(''); setMensaje('')
    try {
      const { data } = await negociosApi.crear({ ...form, nombre: form.nombre.trim() })
      await recargarNegocios(data.id)
      setMensaje(`Negocio "${data.nombre}" creado y seleccionado. Ya puedes registrar clientes, productos y empleados.`)
      setForm(VACIO); setEditado({ id: false, prefijo: false })
    } catch (e) {
      const detalle = e.response?.data?.detail
      setError(Array.isArray(detalle) ? 'Revisa los datos: identificador, prefijo o nombre no válidos.' : (detalle || 'No se pudo crear el negocio'))
    } finally { setGuardando(false) }
  }

  const s = {
    h1:     { fontSize: 22, fontWeight: 700, margin: '0 0 20px', color: '#1e293b' },
    card:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
    label:  { fontSize: 12, color: '#64748b', marginBottom: 4 },
    hint:   { fontSize: 11, color: '#94a3b8', marginTop: 3 },
    input:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    row2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 },
    btn:    { padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#3b82f6', color: '#fff' },
    th:     { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
    td:     { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13 },
    err:    { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
    ok:     { background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  }

  if (!esAdmin) {
    return <div style={{ color: '#64748b' }}>Solo un administrador puede dar de alta negocios.</div>
  }

  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', maxWidth: 900 }}>
      <h1 style={s.h1}>Negocios</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20, alignItems: 'start' }}>
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr><th style={s.th}>Negocio</th><th style={s.th}>Giro</th><th style={s.th}>Identificador</th></tr>
            </thead>
            <tbody>
              {negociosDisponibles.map(n => (
                <tr key={n.id}>
                  <td style={{ ...s.td, fontWeight: n.id === negocioId ? 700 : 400 }}>{n.nombre}</td>
                  <td style={s.td}>{NOMBRE_GIRO[n.tipo] || n.tipo || '—'}</td>
                  <td style={{ ...s.td, fontFamily: 'monospace', color: '#64748b' }}>{n.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form style={s.card} onSubmit={crear}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Nuevo negocio</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Se crea con su catálogo de cuentas contables y el periodo del mes, listo para operar.
          </div>
          {error && <div style={s.err}>{error}</div>}
          {mensaje && <div style={s.ok}>{mensaje}</div>}

          <label style={s.label}>Nombre</label>
          <input style={s.input} required minLength={2} maxLength={120} value={form.nombre}
            onChange={e => cambiarNombre(e.target.value)} placeholder="Ej. Ferretería del Centro" />

          <div style={s.row2}>
            <div>
              <label style={s.label}>Identificador</label>
              <input style={{ ...s.input, fontFamily: 'monospace' }} required pattern="[a-z][a-z0-9_]{2,39}"
                value={form.id}
                onChange={e => { setEditado(x => ({ ...x, id: true })); setForm(f => ({ ...f, id: e.target.value })) }} />
              <div style={s.hint}>Minúsculas y guiones bajos. No se puede cambiar después.</div>
            </div>
            <div>
              <label style={s.label}>Prefijo de folios</label>
              <input style={{ ...s.input, fontFamily: 'monospace' }} required pattern="[A-Z0-9]{2,6}"
                value={form.prefijo}
                onChange={e => { setEditado(x => ({ ...x, prefijo: true })); setForm(f => ({ ...f, prefijo: e.target.value.toUpperCase() })) }} />
              <div style={s.hint}>Cotizaciones {form.prefijo || 'XX'}-…, pedidos PED-{form.prefijo || 'XX'}-…</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={s.label}>Giro</label>
            <select style={s.input} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
              {GIROS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="submit" style={s.btn} disabled={guardando}>{guardando ? 'Creando…' : 'Crear negocio'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
