import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, diaISO, fechaHora, s, Campo } from './comun'

const TIPOS = {
  entrada: 'Entrada de lote',
  salida:  'Salida',
  merma:   'Merma (caducado o dañado)',
}

// Avisa a la barra lateral que el inventario cambió (actualiza el badge de alertas)
export const avisarCambioFarmacia = () => window.dispatchEvent(new Event('farmacia:cambio'))

export default function EntradaSalidaModal({ articulo, tipo: tipoInicial = 'entrada', cerrar, onGuardado }) {
  const [tipo, setTipo] = useState(tipoInicial)
  const [cantidad, setCantidad] = useState('')
  const [lote, setLote] = useState('')
  const [caducidad, setCaducidad] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [precio, setPrecio] = useState('')
  const [motivo, setMotivo] = useState('')
  const [receta, setReceta] = useState(null)
  const [busquedaRx, setBusquedaRx] = useState('')
  const [recetas, setRecetas] = useState([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const hoy = diaISO(new Date())
  const lotes = articulo.lotes || []
  const vigentes = lotes.filter(l => l.fecha_caducidad >= hoy)
  const loteElegido = lotes.find(l => l.numero_lote === lote)
  const disponible = tipo === 'merma'
    ? (loteElegido ? loteElegido.cantidad : lotes.reduce((n, l) => n + l.cantidad, 0))
    : (loteElegido ? loteElegido.cantidad : vigentes.reduce((n, l) => n + l.cantidad, 0))

  useEffect(() => { setLote(''); setError('') }, [tipo])

  // Al surtir una receta, se busca por folio o paciente
  useEffect(() => {
    if (tipo !== 'salida' || receta || !busquedaRx.trim()) { setRecetas([]); return }
    const t = setTimeout(() => {
      req(`/api/clinica/recetas?${qs({ negocio_id: articulo.negocio_id, q: busquedaRx, limit: 6 })}`)
        .then(d => setRecetas(d.items.filter(r => r.estado === 'vigente'))).catch(() => setRecetas([]))
    }, 250)
    return () => clearTimeout(t)
  }, [tipo, busquedaRx, receta, articulo.negocio_id])

  // Un lote existente ya tiene caducidad: se llena sola
  const loteExistente = tipo === 'entrada' && lotes.find(l => l.numero_lote === lote.trim())
  useEffect(() => { if (loteExistente) setCaducidad(loteExistente.fecha_caducidad) }, [loteExistente?.numero_lote])

  async function guardar(ev) {
    ev.preventDefault()
    const n = Number(cantidad)
    if (!Number.isInteger(n) || n <= 0) { setError('La cantidad debe ser un número entero mayor a 0'); return }
    if (tipo === 'entrada' && (!lote.trim() || !caducidad)) { setError('Indica el número de lote y su caducidad'); return }
    if (tipo !== 'entrada' && n > disponible) { setError(`Solo hay ${disponible} disponibles`); return }
    setGuardando(true); setError('')
    try {
      const r = tipo === 'entrada'
        ? await req(`/api/clinica/farmacia/${articulo.id}/entrada`, {
            method: 'POST',
            body: JSON.stringify({
              numero_lote: lote.trim(), fecha_caducidad: caducidad, cantidad: n, proveedor, motivo,
              precio_compra: precio === '' ? null : Number(precio),
            }),
          })
        : await req(`/api/clinica/farmacia/${articulo.id}/salida?merma=${tipo === 'merma'}`, {
            method: 'POST',
            body: JSON.stringify({ cantidad: n, numero_lote: lote, receta_id: receta?.id || '', motivo }),
          })
      avisarCambioFarmacia()
      onGuardado(r.articulo)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario
      titulo={TIPOS[tipo]}
      subtitulo={[articulo.nombre, articulo.presentacion].filter(Boolean).join(' · ') + ` · Existencia: ${articulo.stock}`}
      ancho={560}
      error={error}
      cerrar={cerrar}
      onSubmit={guardar}
      guardando={guardando}
      textoGuardar={tipo === 'entrada' ? 'Registrar entrada' : 'Registrar salida'}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {Object.entries(TIPOS).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTipo(k)} style={{ ...s.btn(tipo === k ? 'primary' : 'ghost'), flex: 1, padding: '7px 6px', fontSize: 12 }}>
            {k === 'merma' ? 'Merma' : l.split(' ')[0]}
          </button>
        ))}
      </div>

      {tipo === 'entrada' ? (
        <div style={s.grid(160)}>
          <Campo label="Número de lote *">
            <input style={s.input} list="lotes-articulo" value={lote} onChange={e => setLote(e.target.value)} autoCapitalize="characters" />
            <datalist id="lotes-articulo">{lotes.map(l => <option key={l.numero_lote} value={l.numero_lote} />)}</datalist>
          </Campo>
          <Campo label="Caducidad *">
            <input style={s.input} type="date" value={caducidad} disabled={Boolean(loteExistente)} onChange={e => setCaducidad(e.target.value)} />
          </Campo>
          <Campo label="Cantidad *">
            <input style={s.input} type="number" min={1} step={1} inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value)} />
          </Campo>
          <Campo label="Precio de compra (unidad)">
            <input style={s.input} type="number" min={0} step="0.01" inputMode="decimal" placeholder={String(articulo.precio_compra ?? '')} value={precio} onChange={e => setPrecio(e.target.value)} />
          </Campo>
          <Campo label="Proveedor" style={{ gridColumn: '1 / -1' }}>
            <input style={s.input} value={proveedor} onChange={e => setProveedor(e.target.value)} />
          </Campo>
          {caducidad && caducidad < hoy && (
            <div style={{ ...s.err, gridColumn: '1 / -1', marginBottom: 0 }}>Esa fecha de caducidad ya pasó.</div>
          )}
        </div>
      ) : (
        <>
          <Campo label="Lote">
            <select style={s.input} value={lote} onChange={e => setLote(e.target.value)}>
              <option value="">{tipo === 'merma' ? 'Cualquiera (el que caduca antes)' : 'Automático: el que caduca antes'}</option>
              {(tipo === 'merma' ? lotes : vigentes).map(l => (
                <option key={l.numero_lote} value={l.numero_lote}>
                  {l.numero_lote} · {l.cantidad} pzas · cad. {l.fecha_caducidad}{l.fecha_caducidad < hoy ? ' (CADUCADO)' : ''}
                </option>
              ))}
            </select>
          </Campo>
          {tipo === 'salida' && lotes.length > vigentes.length && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 4 }}>Los lotes caducados no se surten; dales salida como merma.</div>
          )}
          <Campo label={`Cantidad * (disponible: ${disponible})`} style={{ marginTop: 12 }}>
            <input style={s.input} type="number" min={1} max={disponible} step={1} inputMode="numeric" value={cantidad} onChange={e => setCantidad(e.target.value)} />
          </Campo>

          {tipo === 'salida' && (
            <>
              <div style={s.sect}>Receta (opcional)</div>
              {receta ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#b91c1c' }}>{receta.folio}</span>
                  <span style={{ flex: 1 }}>{receta.paciente?.nombre}</span>
                  <button type="button" style={s.btn('ghost')} onClick={() => { setReceta(null); setBusquedaRx('') }}>Quitar</button>
                </div>
              ) : (
                <>
                  <input style={s.input} placeholder="Buscar receta por folio o paciente…" value={busquedaRx} onChange={e => setBusquedaRx(e.target.value)} />
                  {recetas.map(r => (
                    <button key={r.id} type="button" onClick={() => setReceta(r)} style={{
                      display: 'block', width: '100%', textAlign: 'left', marginTop: 4, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13,
                    }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#b91c1c' }}>{r.folio}</span> · {r.paciente?.nombre}
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>{fechaHora(r.fecha)} · {r.medicamentos.map(m => m.nombre).join(', ')}</div>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}

      <Campo label="Motivo / nota" style={{ marginTop: 12 }}>
        <input style={s.input} placeholder={tipo === 'entrada' ? 'Compra, donación…' : tipo === 'merma' ? 'Caducado, dañado…' : 'Uso en consulta, venta…'}
          value={motivo} onChange={e => setMotivo(e.target.value)} />
      </Campo>
    </ModalFormulario>
  )
}
