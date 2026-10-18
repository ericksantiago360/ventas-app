import { useEffect, useState } from 'react'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import ModalFormulario from '../../components/ModalFormulario'
import EntradaSalidaModal, { avisarCambioFarmacia } from './EntradaSalidaModal'
import { req, qs, diaISO, fechaHora, s, Campo, Chip } from './comun'

const CATEGORIAS = { medicamento: 'Medicamento', reactivo: 'Reactivo', material: 'Material', equipo: 'Equipo' }
const PLAZOS = {
  caducado: { label: 'Caducados',        bg: '#fee2e2', color: '#b91c1c' },
  30:       { label: 'En 30 días',       bg: '#ffedd5', color: '#c2410c' },
  60:       { label: 'En 31 a 60 días',  bg: '#fef9c3', color: '#a16207' },
  90:       { label: 'En 61 a 90 días',  bg: '#f1f5f9', color: '#475569' },
}

const dinero = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

const ARTICULO_VACIO = {
  nombre: '', principio_activo: '', presentacion: '', categoria: 'medicamento',
  stock_minimo: 0, precio_compra: 0, precio_venta: 0, ubicacion: '',
}

function ArticuloModal({ negocioId, articulo, cerrar, onGuardado }) {
  const [datos, setDatos] = useState(() => Object.fromEntries(Object.keys(ARTICULO_VACIO).map(k => [k, articulo?.[k] ?? ARTICULO_VACIO[k]])))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k, v) => setDatos(d => ({ ...d, [k]: v }))

  async function guardar(ev) {
    ev.preventDefault()
    if (!datos.nombre.trim()) { setError('El nombre es requerido'); return }
    const cuerpo = { ...datos, stock_minimo: Number(datos.stock_minimo) || 0, precio_compra: Number(datos.precio_compra) || 0, precio_venta: Number(datos.precio_venta) || 0 }
    setGuardando(true); setError('')
    try {
      onGuardado(articulo
        ? await req(`/api/clinica/farmacia/${articulo.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) })
        : await req('/api/clinica/farmacia', { method: 'POST', body: JSON.stringify({ ...cuerpo, negocio_id: negocioId }) }))
      avisarCambioFarmacia()
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario titulo={articulo ? 'Editar artículo' : 'Nuevo artículo'} subtitulo={articulo ? undefined : 'La existencia se registra después, por lotes'}
      ancho={620} error={error} cerrar={cerrar} onSubmit={guardar} guardando={guardando} textoGuardar="Guardar">
      <div style={s.grid(180)}>
        <Campo label="Nombre *" style={{ gridColumn: '1 / -1' }}>
          <input style={s.input} autoFocus value={datos.nombre} onChange={e => set('nombre', e.target.value)} />
        </Campo>
        <Campo label="Principio activo">
          <input style={s.input} value={datos.principio_activo} onChange={e => set('principio_activo', e.target.value)} />
        </Campo>
        <Campo label="Presentación">
          <input style={s.input} placeholder="Caja 30 tabletas 500 mg" value={datos.presentacion} onChange={e => set('presentacion', e.target.value)} />
        </Campo>
        <Campo label="Categoría">
          <select style={s.input} value={datos.categoria} onChange={e => set('categoria', e.target.value)}>
            {Object.entries(CATEGORIAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Campo>
        <Campo label="Ubicación">
          <input style={s.input} placeholder="Estante A-3" value={datos.ubicacion} onChange={e => set('ubicacion', e.target.value)} />
        </Campo>
        <Campo label="Stock mínimo (alerta)">
          <input style={s.input} type="number" min={0} step={1} inputMode="numeric" value={datos.stock_minimo} onChange={e => set('stock_minimo', e.target.value)} />
        </Campo>
        <Campo label="Precio de compra">
          <input style={s.input} type="number" min={0} step="0.01" inputMode="decimal" value={datos.precio_compra} onChange={e => set('precio_compra', e.target.value)} />
        </Campo>
        <Campo label="Precio de venta">
          <input style={s.input} type="number" min={0} step="0.01" inputMode="decimal" value={datos.precio_venta} onChange={e => set('precio_venta', e.target.value)} />
        </Campo>
      </div>
    </ModalFormulario>
  )
}

function Alertas({ a }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {a.stock === 0 ? <Chip texto="Agotado" bg="#fee2e2" color="#b91c1c" />
        : a.stock_bajo && <Chip texto="Stock bajo" bg="#ffedd5" color="#c2410c" />}
      {a.stock_caducado > 0 && <Chip texto={`${a.stock_caducado} caducado${a.stock_caducado > 1 ? 's' : ''}`} bg="#fee2e2" color="#b91c1c" />}
      {a.por_caducar && <Chip texto="Por caducar" bg="#fef9c3" color="#a16207" />}
    </span>
  )
}

function DetalleArticulo({ articulo, cerrar, onMovimiento, onEditar, onBaja }) {
  const [movs, setMovs] = useState(null)
  const hoy = diaISO(new Date())
  useEffect(() => {
    req(`/api/clinica/farmacia/${articulo.id}/movimientos`).then(setMovs).catch(() => setMovs([]))
  }, [articulo.id, articulo.stock, articulo.lotes.length])

  return (
    <div onClick={e => e.target === e.currentTarget && cerrar()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 640, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{articulo.nombre}</h2>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
              {[articulo.principio_activo, articulo.presentacion, CATEGORIAS[articulo.categoria], articulo.ubicacion].filter(Boolean).join(' · ')}
            </div>
            <div style={{ marginTop: 6 }}><Alertas a={articulo} /></div>
          </div>
          <button onClick={cerrar} aria-label="Cerrar" style={{ ...s.btn('ghost'), fontSize: 18, lineHeight: 1, padding: '2px 10px' }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 24, margin: '16px 0', flexWrap: 'wrap' }}>
          {[['Existencia', articulo.stock], ['Mínimo', articulo.stock_minimo], ['Compra', dinero(articulo.precio_compra)], ['Venta', dinero(articulo.precio_venta)]].map(([k, v]) => (
            <div key={k}><div style={s.kv}>{k}</div><div style={{ fontSize: 18, fontWeight: 700 }}>{v}</div></div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={s.btn('success')} onClick={() => onMovimiento('entrada')}>+ Entrada</button>
          <button style={s.btn()} disabled={!articulo.stock} onClick={() => onMovimiento('salida')}>− Salida</button>
          <button style={s.btn('ghost')} onClick={onEditar}>Editar</button>
          {!articulo.stock && <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={onBaja}>Dar de baja</button>}
        </div>

        <div style={s.sect}>Lotes</div>
        {articulo.lotes.length === 0 ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Sin existencia</div> : (
          <table style={s.table}>
            <thead><tr>{['Lote', 'Caducidad', 'Cantidad', 'Proveedor'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {articulo.lotes.map(l => (
                <tr key={l.numero_lote}>
                  <td style={{ ...s.td, fontFamily: 'monospace' }}>{l.numero_lote}</td>
                  <td style={{ ...s.td, color: l.fecha_caducidad < hoy ? '#b91c1c' : undefined, fontWeight: l.fecha_caducidad < hoy ? 700 : 400 }}>
                    {l.fecha_caducidad}{l.fecha_caducidad < hoy && ' · caducado'}
                  </td>
                  <td style={s.td}>{l.cantidad}</td>
                  <td style={{ ...s.td, color: '#64748b' }}>{l.proveedor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={s.sect}>Movimientos</div>
        {!movs ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Cargando…</div>
          : movs.length === 0 ? <div style={{ fontSize: 13, color: '#94a3b8' }}>Sin movimientos</div>
          : movs.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <span style={{ fontWeight: 700, width: 44, color: m.tipo === 'entrada' ? '#15803d' : '#b91c1c', fontVariantNumeric: 'tabular-nums' }}>
                {m.tipo === 'entrada' ? '+' : '−'}{m.cantidad}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{m.motivo || (m.tipo === 'entrada' ? 'Entrada' : 'Salida')}
                  <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}> · {m.lotes.map(l => `${l.numero_lote}×${l.cantidad}`).join(', ')}</span>
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>{fechaHora(m.fecha)}{m.usuario ? ` · ${m.usuario}` : ''}</div>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

function Caducidades({ negocioId, version, onAbrir }) {
  const [lotes, setLotes] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    req(`/api/clinica/farmacia/caducidades?${qs({ negocio_id: negocioId, dias: 90 })}`).then(setLotes).catch(e => setError(e.message))
  }, [negocioId, version])

  if (error) return <div style={s.err}>{error}</div>
  if (!lotes) return <div style={{ color: '#94a3b8' }}>Cargando…</div>
  if (!lotes.length) return <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>Nada caduca en los próximos 90 días</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Object.entries(PLAZOS).map(([plazo, p]) => {
        const grupo = lotes.filter(l => l.plazo === plazo)
        if (!grupo.length) return null
        const valor = grupo.reduce((n, l) => n + l.cantidad * (l.precio_compra || 0), 0)
        return (
          <div key={plazo} style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
            <div style={{ background: p.bg, color: p.color, padding: '8px 16px', fontWeight: 700, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span>{p.label} · {grupo.length} lote{grupo.length > 1 ? 's' : ''}</span>
              {valor > 0 && <span>{dinero(valor)} a costo</span>}
            </div>
            {grupo.map(l => (
              <button key={`${l.articulo_id}-${l.numero_lote}`} onClick={() => onAbrir(l.articulo_id)} style={{
                display: 'flex', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid #f1f5f9',
                padding: '10px 16px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, alignItems: 'center',
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>{l.nombre}</span>
                  <span style={{ color: '#94a3b8' }}> · {l.presentacion}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>Lote {l.numero_lote}{l.ubicacion ? ` · ${l.ubicacion}` : ''}</span>
                </span>
                <span style={{ fontWeight: 700, color: '#334155' }}>{l.cantidad} pzas</span>
                <span style={{ width: 110, textAlign: 'right', color: p.color, fontWeight: 600 }}>
                  {l.fecha_caducidad}<span style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>{l.dias < 0 ? `hace ${-l.dias} días` : l.dias === 0 ? 'hoy' : `en ${l.dias} días`}</span>
                </span>
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function FarmaciaPage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const [tab, setTab] = useState('inventario')
  const [articulos, setArticulos] = useState([])
  const [alertas, setAlertas] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [detalleId, setDetalleId] = useState(null)
  const [modal, setModal] = useState(null)        // { tipo: 'articulo', articulo? } | { tipo: 'entrada'|'salida', articulo }

  useEffect(() => {
    if (!negocioId) return
    let vigente = true
    setCargando(true); setError('')
    Promise.all([
      req(`/api/clinica/farmacia?${qs({ negocio_id: negocioId, categoria, solo_alertas: soloAlertas || '' })}`),
      req(`/api/clinica/farmacia/alertas?${qs({ negocio_id: negocioId })}`),
    ]).then(([a, al]) => { if (vigente) { setArticulos(a); setAlertas(al) } })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [negocioId, categoria, soloAlertas, version])

  const recargar = () => setVersion(v => v + 1)
  const terminos = busqueda.toLowerCase().split(/\s+/).filter(Boolean)
  const visibles = articulos.filter(a => terminos.every(t =>
    [a.nombre, a.principio_activo, a.presentacion, a.ubicacion].some(c => c?.toLowerCase().includes(t))))
  const detalle = articulos.find(a => a.id === detalleId)

  function actualizado(a) {
    setArticulos(as => as.some(x => x.id === a.id) ? as.map(x => x.id === a.id ? a : x) : [...as, a].sort((x, y) => x.nombre.localeCompare(y.nombre)))
    setModal(null)
    recargar()
  }

  async function darDeBaja(a) {
    if (!window.confirm(`¿Dar de baja "${a.nombre}"? Dejará de aparecer en el inventario.`)) return
    try {
      await req(`/api/clinica/farmacia/${a.id}`, { method: 'DELETE' })
      setDetalleId(null); avisarCambioFarmacia(); recargar()
    } catch (e) { setError(e.message) }
  }

  const valorInventario = articulos.reduce((n, a) => n + a.stock * (a.precio_compra || 0), 0)

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Farmacia</h1>
        <button style={s.btn()} onClick={() => setModal({ tipo: 'articulo' })}>+ Nuevo artículo</button>
      </div>

      {alertas?.total > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          {[
            [alertas.stock_bajo.length, 'con stock bajo', '#ffedd5', '#c2410c', () => { setTab('inventario'); setSoloAlertas(true) }],
            [alertas.por_caducar.length, 'lotes caducan en 30 días', '#fef9c3', '#a16207', () => setTab('caducidades')],
            [alertas.caducados.length, 'lotes caducados con existencia', '#fee2e2', '#b91c1c', () => setTab('caducidades')],
          ].filter(([n]) => n).map(([n, texto, bg, color, accion]) => (
            <button key={texto} onClick={accion} style={{ background: bg, color, border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {n} {texto}
            </button>
          ))}
        </div>
      )}

      <div style={s.tabs}>
        {[['inventario', 'Inventario'], ['caducidades', 'Caducidades']].map(([k, l]) => (
          <button key={k} style={s.tab(tab === k)} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {error && <div style={s.err}>{error}</div>}

      {tab === 'caducidades' ? <Caducidades negocioId={negocioId} version={version} onAbrir={(id) => { setCategoria(''); setSoloAlertas(false); setDetalleId(id) }} /> : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...s.input, maxWidth: esMovil ? 'none' : 320, flex: esMovil ? '1 1 100%' : undefined }}
              placeholder="Buscar por nombre, principio activo, ubicación…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            <select style={{ ...s.input, width: 'auto' }} value={categoria} onChange={e => setCategoria(e.target.value)}>
              <option value="">Todas las categorías</option>
              {Object.entries(CATEGORIAS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <label style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={soloAlertas} onChange={e => setSoloAlertas(e.target.checked)} /> Solo con alertas
            </label>
            {!esMovil && <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>{visibles.length} artículos · {dinero(valorInventario)} a costo</span>}
          </div>

          {cargando && !articulos.length ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
            : !visibles.length ? (
              <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>
                {articulos.length ? 'Sin coincidencias' : 'Aún no hay artículos en la farmacia'}
              </div>
            ) : esMovil ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visibles.map(a => (
                  <div key={a.id} onClick={() => setDetalleId(a.id)} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{a.nombre}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>{[a.presentacion, a.ubicacion].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: a.stock_bajo ? '#c2410c' : '#1e293b' }}>{a.stock}</div>
                    </div>
                    <div style={{ marginTop: 6 }}><Alertas a={a} /></div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', opacity: cargando ? 0.6 : 1 }}>
                <table style={s.table}>
                  <thead>
                    <tr>{['Artículo', 'Categoría', 'Existencia', 'Próx. caducidad', 'Ubicación', 'Precio venta', ''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {visibles.map(a => (
                      <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setDetalleId(a.id)}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{a.nombre}</div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{[a.principio_activo, a.presentacion].filter(Boolean).join(' · ')}</div>
                          <div style={{ marginTop: 3 }}><Alertas a={a} /></div>
                        </td>
                        <td style={s.td}>{CATEGORIAS[a.categoria]}</td>
                        <td style={s.td}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: a.stock_bajo ? '#c2410c' : '#1e293b' }}>{a.stock}</span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}> / mín. {a.stock_minimo}</span>
                        </td>
                        <td style={s.td}>{a.proxima_caducidad || '—'}</td>
                        <td style={{ ...s.td, color: '#64748b' }}>{a.ubicacion || '—'}</td>
                        <td style={s.td}>{dinero(a.precio_venta)}</td>
                        <td style={s.td} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={{ ...s.btn('success'), padding: '5px 10px', fontSize: 12 }} onClick={() => setModal({ tipo: 'entrada', articulo: a })}>Entrada</button>
                            <button style={{ ...s.btn('ghost'), padding: '5px 10px', fontSize: 12 }} disabled={!a.stock} onClick={() => setModal({ tipo: 'salida', articulo: a })}>Salida</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      {detalle && !modal && (
        <DetalleArticulo
          articulo={detalle}
          cerrar={() => setDetalleId(null)}
          onMovimiento={(tipo) => setModal({ tipo, articulo: detalle })}
          onEditar={() => setModal({ tipo: 'articulo', articulo: detalle })}
          onBaja={() => darDeBaja(detalle)}
        />
      )}
      {modal?.tipo === 'articulo' && (
        <ArticuloModal negocioId={negocioId} articulo={modal.articulo} cerrar={() => setModal(null)} onGuardado={actualizado} />
      )}
      {(modal?.tipo === 'entrada' || modal?.tipo === 'salida') && (
        <EntradaSalidaModal articulo={modal.articulo} tipo={modal.tipo} cerrar={() => setModal(null)} onGuardado={actualizado} />
      )}
    </div>
  )
}
