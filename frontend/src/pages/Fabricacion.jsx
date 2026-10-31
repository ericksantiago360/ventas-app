import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const ESTADOS = [
  { value: 'planeada',   label: 'Planeada',   color: '#2563eb', bg: '#eff6ff' },
  { value: 'terminada',  label: 'Terminada',  color: '#16a34a', bg: '#f0fdf4' },
  { value: 'cancelada',  label: 'Cancelada',  color: '#dc2626', bg: '#fef2f2' },
]
const estadoInfo = (v) => ESTADOS.find(e => e.value === v) || ESTADOS[0]

function num(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? n.toString() : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function fecha(v) {
  if (!v) return '--'
  try { return new Date(v).toLocaleDateString('es-MX') } catch { return v }
}

function mensajeError(err, fallback) {
  const detalle = err.response?.data?.detail
  if (Array.isArray(detalle)) return detalle.map(d => d.msg).join('. ') || fallback
  return detalle || fallback
}

const emptyReceta = { nombre: '', producto_id: '', rendimiento: '', componentes: [] }
const emptyOrden = { receta_id: '', cantidad: '', almacen_id: '', ubicacion_destino_id: '', notas: '' }

export default function Fabricacion() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [tab, setTab]               = useState('ordenes')
  const [ordenes, setOrdenes]       = useState([])
  const [recetas, setRecetas]       = useState([])
  const [inventario, setInventario] = useState([])
  const [almacenes, setAlmacenes]   = useState([])
  const [zonas, setZonas]           = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [stockUbic, setStockUbic]   = useState({ ubicaciones: [], sin_ubicacion: [] })
  const [almacenActivo, setAlmacenActivo] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [cargando, setCargando]     = useState(false)
  const [error, setError]           = useState('')
  const [guardando, setGuardando]   = useState(false)

  const [modal, setModal]           = useState(null) // 'orden' | 'detalle' | 'receta' | 'asignar' | 'transferir'
  const [ordenActiva, setOrdenActiva] = useState(null)
  const [formOrden, setFormOrden]   = useState(emptyOrden)
  const [formReceta, setFormReceta] = useState(emptyReceta)
  const [mov, setMov]               = useState(null) // { inventario_id, producto, unidad, origen_id, origen_codigo, max, ubicacion_id, cantidad }
  const [nuevoAlmacen, setNuevoAlmacen] = useState({ codigo: '', nombre: '' })
  const [nuevaZona, setNuevaZona]   = useState({ almacen_id: '', codigo: '', nombre: '' })
  const [nuevaUbicacion, setNuevaUbicacion] = useState({ zona_id: '', codigo: '', nombre: '' })

  const cargarTodo = async () => {
    setCargando(true)
    setError('')
    try {
      const [ordRes, recRes, stockRes, almRes, zonRes, ubRes, suRes] = await Promise.all([
        api.get('/api/fabricacion/ordenes', { params: { negocio_id: negocioId } }),
        api.get('/api/fabricacion/recetas', { params: { negocio_id: negocioId } }),
        api.get('/api/inventario/stock', { params: { negocio_id: negocioId } }),
        api.get('/api/fabricacion/almacenes', { params: { negocio_id: negocioId } }),
        api.get('/api/fabricacion/zonas', { params: { negocio_id: negocioId } }),
        api.get('/api/fabricacion/ubicaciones', { params: { negocio_id: negocioId } }),
        api.get('/api/fabricacion/stock-ubicaciones', { params: { negocio_id: negocioId } }),
      ])
      setOrdenes(ordRes.data || [])
      setRecetas(recRes.data || [])
      setInventario(stockRes.data || [])
      setAlmacenes(almRes.data || [])
      setZonas(zonRes.data || [])
      setUbicaciones(ubRes.data || [])
      setStockUbic(suRes.data || { ubicaciones: [], sin_ubicacion: [] })
      setAlmacenActivo(actual => (almRes.data || []).some(a => a.id === actual) ? actual : (almRes.data?.[0]?.id || ''))
    } catch (err) {
      setError(mensajeError(err, 'Error al cargar fabricación.'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarTodo() }, [negocioId])

  const ordenesFiltradas = useMemo(
    () => filtroEstado ? ordenes.filter(o => o.estado === filtroEstado) : ordenes,
    [ordenes, filtroEstado]
  )

  const nombreAlmacen = (id) => almacenes.find(a => a.id === id)?.nombre || ''
  const etiquetaUbicacion = (u) => `${nombreAlmacen(u.almacen_id)} · ${u.codigo}${u.nombre ? ` (${u.nombre})` : ''}`

  // Ubicaciones del almacén activo, para la vista de stock
  const ubicacionesDelAlmacen = useMemo(
    () => ubicaciones.filter(u => u.almacen_id === almacenActivo),
    [ubicaciones, almacenActivo]
  )
  const stockDelAlmacen = useMemo(
    () => stockUbic.ubicaciones.filter(u => u.almacen_id === almacenActivo),
    [stockUbic, almacenActivo]
  )

  // ── Órdenes ───────────────────────────────────────────────────────────────

  const abrirNuevaOrden = () => {
    setFormOrden({
      ...emptyOrden,
      receta_id: recetas.find(r => r.activo !== false)?.id || '',
      almacen_id: almacenActivo || almacenes[0]?.id || '',
      ubicacion_destino_id: ubicaciones[0]?.id || '',
    })
    setModal('orden')
  }

  const guardarOrden = async (e) => {
    e.preventDefault()
    if (!formOrden.receta_id) { setError('Elige una receta.'); return }
    if (!formOrden.almacen_id) { setError('Elige el almacén de origen.'); return }
    if (!formOrden.ubicacion_destino_id) { setError('Elige la ubicación de destino del producto terminado.'); return }
    setGuardando(true)
    setError('')
    try {
      await api.post('/api/fabricacion/ordenes', {
        negocio_id: negocioId,
        receta_id: formOrden.receta_id,
        cantidad: Number(formOrden.cantidad),
        almacen_id: formOrden.almacen_id,
        ubicacion_destino_id: formOrden.ubicacion_destino_id,
        notas: formOrden.notas,
      })
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo crear la orden.'))
    } finally {
      setGuardando(false)
    }
  }

  const abrirDetalle = async (orden) => {
    try {
      const { data } = await api.get(`/api/fabricacion/ordenes/${orden.id}`)
      setOrdenActiva(data)
      setModal('detalle')
    } catch (err) {
      setError(mensajeError(err, 'No se pudo abrir la orden.'))
    }
  }

  const accionOrden = async (url, fallback, body) => {
    setGuardando(true)
    setError('')
    try {
      const { data } = await api.post(url, body)
      setOrdenActiva(data)
      await cargarTodo()
      return true
    } catch (err) {
      setError(mensajeError(err, fallback))
      return false
    } finally {
      setGuardando(false)
    }
  }

  const terminarOrden = async () => {
    if (!window.confirm(`¿Fabricar ${num(ordenActiva.cantidad)} ${ordenActiva.producto.unidad} de ${ordenActiva.producto.nombre}? Se consumen los insumos de ${ordenActiva.almacen_nombre}.`)) return
    const ok = await accionOrden(`/api/fabricacion/ordenes/${ordenActiva.id}/terminar`, 'No se pudo terminar la orden.')
    if (ok) setModal('detalle')
  }

  const cancelarOrden = async () => {
    const motivo = window.prompt(`Motivo para cancelar ${ordenActiva.numero}:`)
    if (!motivo || !motivo.trim()) return
    const ok = await accionOrden(`/api/fabricacion/ordenes/${ordenActiva.id}/cancelar`, 'No se pudo cancelar la orden.', { motivo: motivo.trim() })
    if (ok) setModal('detalle')
  }

  // ── Recetas ───────────────────────────────────────────────────────────────

  const abrirNuevaReceta = () => {
    setFormReceta(emptyReceta)
    setModal('receta')
  }

  const agregarComponente = (inventarioId) => {
    if (!inventarioId) return
    if (formReceta.componentes.some(c => c.inventario_id === inventarioId)) return
    const p = inventario.find(i => i.id === inventarioId)
    if (!p) return
    setFormReceta(f => ({ ...f, componentes: [...f.componentes, { inventario_id: p.id, nombre: p.nombre, unidad: p.unidad, cantidad: 1 }] }))
  }

  const cambiarComponente = (idx, cantidad) => {
    setFormReceta(f => ({ ...f, componentes: f.componentes.map((c, n) => n === idx ? { ...c, cantidad } : c) }))
  }

  const quitarComponente = (idx) => {
    setFormReceta(f => ({ ...f, componentes: f.componentes.filter((_, n) => n !== idx) }))
  }

  const guardarReceta = async (e) => {
    e.preventDefault()
    if (!formReceta.nombre.trim()) { setError('El nombre es requerido.'); return }
    if (!formReceta.producto_id) { setError('Elige el producto terminado.'); return }
    if (formReceta.componentes.length === 0) { setError('Agrega al menos un insumo.'); return }
    setGuardando(true)
    setError('')
    try {
      await api.post('/api/fabricacion/recetas', {
        negocio_id: negocioId,
        nombre: formReceta.nombre.trim(),
        producto_id: formReceta.producto_id,
        rendimiento: Number(formReceta.rendimiento),
        componentes: formReceta.componentes.map(c => ({ inventario_id: c.inventario_id, cantidad: Number(c.cantidad) })),
      })
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar la receta.'))
    } finally {
      setGuardando(false)
    }
  }

  // ── Almacenes ─────────────────────────────────────────────────────────────

  const enviar = async (url, cuerpo, fallback, despues) => {
    setError('')
    try {
      await api.post(url, { negocio_id: negocioId, ...cuerpo })
      if (despues) despues()
      await cargarTodo()
      return true
    } catch (err) {
      setError(mensajeError(err, fallback))
      return false
    }
  }

  const crearAlmacen = (e) => {
    e.preventDefault()
    enviar('/api/fabricacion/almacenes', nuevoAlmacen, 'No se pudo crear el almacén.',
      () => setNuevoAlmacen({ codigo: '', nombre: '' }))
  }

  const crearZona = (e) => {
    e.preventDefault()
    enviar('/api/fabricacion/zonas', nuevaZona, 'No se pudo crear la zona.',
      () => setNuevaZona(z => ({ ...z, codigo: '', nombre: '' })))
  }

  const crearUbicacion = (e) => {
    e.preventDefault()
    enviar('/api/fabricacion/ubicaciones', nuevaUbicacion, 'No se pudo crear la ubicación.',
      () => setNuevaUbicacion(u => ({ ...u, codigo: '', nombre: '' })))
  }

  const abrirAsignar = (fila) => {
    setMov({
      inventario_id: fila.inventario_id, producto: fila.producto, unidad: fila.unidad,
      max: fila.cantidad, ubicacion_id: ubicaciones.find(u => u.almacen_id === almacenActivo)?.id || '', cantidad: '',
    })
    setModal('asignar')
  }

  const abrirTransferir = (fila) => {
    setMov({
      inventario_id: fila.inventario_id, producto: fila.producto, unidad: fila.unidad,
      origen_id: fila.ubicacion_id, origen_codigo: fila.ubicacion_codigo, max: fila.cantidad,
      ubicacion_id: '', cantidad: '',
    })
    setModal('transferir')
  }

  const guardarMovimiento = async (e) => {
    e.preventDefault()
    const cantidad = Number(mov.cantidad)
    if (!(cantidad > 0)) { setError('Indica una cantidad mayor que cero.'); return }
    if (cantidad > mov.max + 1e-9) { setError(`Máximo ${num(mov.max)} ${mov.unidad}.`); return }
    setGuardando(true)
    let ok
    if (modal === 'asignar') {
      ok = await enviar('/api/fabricacion/stock-ubicaciones/asignar',
        { inventario_id: mov.inventario_id, ubicacion_id: mov.ubicacion_id, cantidad },
        'No se pudo asignar el stock.', () => setModal(null))
    } else {
      ok = await enviar('/api/fabricacion/stock-ubicaciones/transferir',
        { inventario_id: mov.inventario_id, origen_id: mov.origen_id, destino_id: mov.ubicacion_id, cantidad },
        'No se pudo transferir el stock.', () => setModal(null))
    }
    setGuardando(false)
    return ok
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Fabricación</h1>
          <p style={s.subtitle}>Recetas, órdenes de producción y almacenes con sus ubicaciones</p>
        </div>
        <div style={s.headerActions}>
          <select value={negocioId} onChange={e => setNegocioId(e.target.value)} style={s.select}>
            {negociosDisponibles.map(n => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
          {tab === 'ordenes' && <button onClick={abrirNuevaOrden} style={s.primaryBtn}>+ Nueva orden</button>}
          {tab === 'recetas' && <button onClick={abrirNuevaReceta} style={s.primaryBtn}>+ Nueva receta</button>}
        </div>
      </div>

      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      <div style={s.tabs}>
        {[['ordenes', 'Órdenes'], ['recetas', 'Recetas'], ['almacenes', 'Almacenes y ubicaciones']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{ ...s.tab, ...(tab === v ? s.tabActive : {}) }}>{l}</button>
        ))}
      </div>

      {cargando && <div style={s.loading}>Cargando…</div>}

      {/* ÓRDENES */}
      {!cargando && tab === 'ordenes' && (
        <>
          <div style={s.filters}>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} style={s.select}>
              <option value="">Todos los estados</option>
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
            <span style={s.counter}>{ordenesFiltradas.length} órdenes</span>
          </div>

          {ordenesFiltradas.length === 0 ? (
            <div style={s.empty}>No hay órdenes de fabricación{filtroEstado ? ' en este estado' : ''}.</div>
          ) : (
            <div style={s.card}>
              <div style={s.tableHeadOrdenes}>
                <span>Folio</span><span>Producto</span><span>Cantidad</span><span>Almacén → destino</span><span>Estado</span><span></span>
              </div>
              {ordenesFiltradas.map(o => {
                const est = estadoInfo(o.estado)
                return (
                  <div key={o.id} style={s.tableRowOrdenes}>
                    <strong>{o.numero}</strong>
                    <span>{o.producto.nombre}</span>
                    <span>{num(o.cantidad)} {o.producto.unidad}</span>
                    <span style={s.muted}>{o.almacen_nombre || 'Sin almacén'} → {o.ubicacion_destino_codigo || '--'}</span>
                    <span style={{ ...s.badge, color: est.color, background: est.bg }}>{est.label}</span>
                    <div><button onClick={() => abrirDetalle(o)} style={s.actionBtn}>Ver</button></div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* RECETAS */}
      {!cargando && tab === 'recetas' && (
        recetas.length === 0 ? (
          <div style={s.empty}>Aún no hay recetas. Crea una con "+ Nueva receta".</div>
        ) : (
          <div style={s.grid}>
            {recetas.map(r => (
              <div key={r.id} style={s.recetaCard}>
                <div style={{ fontWeight: 600, color: '#0f172a' }}>{r.nombre}</div>
                <div style={s.muted}>Produce {num(r.rendimiento)} {r.producto.unidad} de {r.producto.nombre} por tanda</div>
                <div style={{ marginTop: 10, fontSize: 13, color: '#334155' }}>
                  {r.componentes.map(c => (
                    <div key={c.inventario_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span>{c.nombre}</span><span>{num(c.cantidad)} {c.unidad}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ALMACENES Y UBICACIONES */}
      {!cargando && tab === 'almacenes' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={s.panel}>
              <div style={s.panelTitle}>Almacenes</div>
              {almacenes.length === 0 && <div style={s.muted}>Aún no hay almacenes.</div>}
              {almacenes.map(a => (
                <button key={a.id} onClick={() => setAlmacenActivo(a.id)}
                  style={{ ...s.almacenBtn, ...(almacenActivo === a.id ? s.almacenBtnActivo : {}) }}>
                  <strong>{a.codigo}</strong> · {a.nombre}
                </button>
              ))}
              <form onSubmit={crearAlmacen} style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <input style={s.input} placeholder="Código (ej. ALM-1)" value={nuevoAlmacen.codigo}
                  onChange={e => setNuevoAlmacen(f => ({ ...f, codigo: e.target.value }))} required />
                <input style={s.input} placeholder="Nombre" value={nuevoAlmacen.nombre}
                  onChange={e => setNuevoAlmacen(f => ({ ...f, nombre: e.target.value }))} required />
                <button type="submit" style={s.primaryBtn}>+ Nuevo almacén</button>
              </form>
            </div>

            <div style={s.panel}>
              <div style={s.panelTitle}>Zona</div>
              <form onSubmit={crearZona} style={{ display: 'grid', gap: 8 }}>
                <select style={s.input} value={nuevaZona.almacen_id} onChange={e => setNuevaZona(z => ({ ...z, almacen_id: e.target.value }))} required>
                  <option value="">Almacén…</option>
                  {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
                <input style={s.input} placeholder="Código (ej. Z-A)" value={nuevaZona.codigo}
                  onChange={e => setNuevaZona(z => ({ ...z, codigo: e.target.value }))} required />
                <input style={s.input} placeholder="Nombre" value={nuevaZona.nombre}
                  onChange={e => setNuevaZona(z => ({ ...z, nombre: e.target.value }))} required />
                <button type="submit" style={s.secondaryBtn}>+ Nueva zona</button>
              </form>
            </div>

            <div style={s.panel}>
              <div style={s.panelTitle}>Ubicación</div>
              <form onSubmit={crearUbicacion} style={{ display: 'grid', gap: 8 }}>
                <select style={s.input} value={nuevaUbicacion.zona_id} onChange={e => setNuevaUbicacion(u => ({ ...u, zona_id: e.target.value }))} required>
                  <option value="">Zona…</option>
                  {zonas.map(z => <option key={z.id} value={z.id}>{nombreAlmacen(z.almacen_id)} · {z.codigo} {z.nombre}</option>)}
                </select>
                <input style={s.input} placeholder="Código (ej. Z-A-01-02)" value={nuevaUbicacion.codigo}
                  onChange={e => setNuevaUbicacion(u => ({ ...u, codigo: e.target.value }))} required />
                <input style={s.input} placeholder="Descripción (opcional)" value={nuevaUbicacion.nombre}
                  onChange={e => setNuevaUbicacion(u => ({ ...u, nombre: e.target.value }))} />
                <button type="submit" style={s.secondaryBtn}>+ Nueva ubicación</button>
              </form>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            <div style={s.panel}>
              <div style={s.panelTitle}>Ubicaciones de {nombreAlmacen(almacenActivo) || 'este almacén'}</div>
              {ubicacionesDelAlmacen.length === 0 ? (
                <div style={s.muted}>Este almacén no tiene ubicaciones todavía.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ubicacionesDelAlmacen.map(u => (
                    <span key={u.id} style={s.chip}>{u.codigo}{u.nombre ? ` · ${u.nombre}` : ''}</span>
                  ))}
                </div>
              )}
            </div>

            <div style={s.card}>
              <div style={s.tableHeadStock}><span>Producto</span><span>Ubicación</span><span>Cantidad</span><span></span></div>
              {stockDelAlmacen.length === 0 ? (
                <div style={{ ...s.muted, padding: 16 }}>No hay stock asignado a ubicaciones de este almacén.</div>
              ) : stockDelAlmacen.map(f => (
                <div key={`${f.inventario_id}-${f.ubicacion_id}`} style={s.tableRowStock}>
                  <span>{f.producto}</span>
                  <span>{f.ubicacion_codigo}</span>
                  <span>{num(f.cantidad)} {f.unidad}</span>
                  <div><button onClick={() => abrirTransferir(f)} style={s.actionBtn}>Transferir</button></div>
                </div>
              ))}
            </div>

            <div style={s.card}>
              <div style={{ ...s.panelTitle, padding: '12px 14px', borderBottom: '1px solid #e2e8f0' }}>
                Stock sin ubicación
                <span style={{ ...s.muted, marginLeft: 8 }}>Asígnalo a una ubicación antes de usarlo en fabricación</span>
              </div>
              {stockUbic.sin_ubicacion.length === 0 ? (
                <div style={{ ...s.muted, padding: 16 }}>Todo el stock está asignado a una ubicación.</div>
              ) : stockUbic.sin_ubicacion.map(f => (
                <div key={f.inventario_id} style={s.tableRowStock}>
                  <span>{f.producto}</span>
                  <span style={s.muted}>Sin ubicación</span>
                  <span>{num(f.cantidad)} {f.unidad}</span>
                  <div><button onClick={() => abrirAsignar(f)} style={s.actionBtn}>Asignar</button></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NUEVA ORDEN */}
      {modal === 'orden' && (
        <Modal titulo="Nueva orden de fabricación" cerrar={() => setModal(null)} ancho={640}>
          <form onSubmit={guardarOrden}>
            <div style={s.formGrid2}>
              <Campo label="Receta">
                <select style={s.input} value={formOrden.receta_id} onChange={e => setFormOrden(f => ({ ...f, receta_id: e.target.value }))}>
                  <option value="">Elige una receta</option>
                  {recetas.filter(r => r.activo !== false).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Cantidad a fabricar">
                <input style={s.input} type="number" min={0} step="any" value={formOrden.cantidad}
                  onChange={e => setFormOrden(f => ({ ...f, cantidad: e.target.value }))} required />
              </Campo>
              <Campo label="Almacén de origen (insumos)">
                <select style={s.input} value={formOrden.almacen_id} onChange={e => setFormOrden(f => ({ ...f, almacen_id: e.target.value }))}>
                  <option value="">Elige un almacén</option>
                  {almacenes.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Ubicación de destino (producto terminado)">
                <select style={s.input} value={formOrden.ubicacion_destino_id} onChange={e => setFormOrden(f => ({ ...f, ubicacion_destino_id: e.target.value }))}>
                  <option value="">Elige una ubicación</option>
                  {ubicaciones.map(u => <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>)}
                </select>
              </Campo>
            </div>
            <div style={{ marginTop: 14 }}>
              <Campo label="Notas">
                <input style={s.input} value={formOrden.notas} onChange={e => setFormOrden(f => ({ ...f, notas: e.target.value }))} />
              </Campo>
            </div>
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>{guardando ? 'Guardando…' : 'Crear orden'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: DETALLE DE ORDEN */}
      {modal === 'detalle' && ordenActiva && (() => {
        const est = estadoInfo(ordenActiva.estado)
        const faltan = ordenActiva.consumos.some(c => c.faltante > 0)
        return (
          <Modal titulo={`${ordenActiva.numero} — ${ordenActiva.producto.nombre}`} cerrar={() => setModal(null)} ancho={760}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ ...s.badge, color: est.color, background: est.bg }}>{est.label}</span>
              <span style={s.muted}>Receta: {ordenActiva.receta_nombre}</span>
              <span style={s.muted}>· {num(ordenActiva.cantidad)} {ordenActiva.producto.unidad} ({num(ordenActiva.tandas)} tandas)</span>
              <span style={s.muted}>· Insumos de {ordenActiva.almacen_nombre || 'sin almacén'}</span>
              <span style={s.muted}>· Destino {ordenActiva.ubicacion_destino_codigo || '--'}</span>
              {ordenActiva.fecha_terminada && <span style={s.muted}>· Terminada {fecha(ordenActiva.fecha_terminada)}</span>}
            </div>
            {ordenActiva.estado === 'cancelada' && (
              <div style={{ ...s.errorBox, background: '#fef2f2' }}>Motivo: {ordenActiva.motivo_cancelacion}</div>
            )}

            <div style={s.card}>
              <div style={s.tableHeadDetalle}>
                <span>Insumo</span><span>Requerido</span><span>Disponible en almacén</span><span>Estado</span>
              </div>
              {ordenActiva.consumos.map(c => (
                <div key={c.inventario_id} style={s.tableRowDetalle}>
                  <span>{c.nombre}</span>
                  <span>{num(c.cantidad)} {c.unidad}</span>
                  <span>{num(c.disponible)} {c.unidad}</span>
                  <span style={{ color: c.faltante > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                    {c.faltante > 0 ? `Faltan ${num(c.faltante)}` : 'Suficiente'}
                  </span>
                </div>
              ))}
            </div>

            {ordenActiva.notas && <p style={{ ...s.muted, marginTop: 10 }}>Notas: {ordenActiva.notas}</p>}

            <div style={s.modalFooter}>
              {ordenActiva.estado === 'planeada' && (
                <>
                  <button onClick={cancelarOrden} disabled={guardando} style={s.dangerTextBtn}>Cancelar orden</button>
                  <button onClick={terminarOrden} disabled={guardando || faltan} style={{ ...s.primaryBtn, opacity: faltan ? 0.5 : 1 }}>
                    {faltan ? 'Faltan insumos' : 'Terminar fabricación'}
                  </button>
                </>
              )}
            </div>
          </Modal>
        )
      })()}

      {/* MODAL: NUEVA RECETA */}
      {modal === 'receta' && (
        <Modal titulo="Nueva receta" cerrar={() => setModal(null)} ancho={760}>
          <form onSubmit={guardarReceta}>
            <div style={s.formGrid2}>
              <Campo label="Nombre">
                <input style={s.input} value={formReceta.nombre} onChange={e => setFormReceta(f => ({ ...f, nombre: e.target.value }))} required />
              </Campo>
              <Campo label="Producto terminado">
                <select style={s.input} value={formReceta.producto_id} onChange={e => setFormReceta(f => ({ ...f, producto_id: e.target.value }))}>
                  <option value="">Elige un producto</option>
                  {inventario.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Rendimiento por tanda (unidades)">
                <input style={s.input} type="number" min={0} step="any" value={formReceta.rendimiento}
                  onChange={e => setFormReceta(f => ({ ...f, rendimiento: e.target.value }))} required />
              </Campo>
              <Campo label="Agregar insumo">
                <select style={s.input} value="" onChange={e => agregarComponente(e.target.value)}>
                  <option value="">Elige un insumo…</option>
                  {inventario.filter(p => p.id !== formReceta.producto_id).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
            </div>

            <div style={{ marginTop: 16 }}>
              {formReceta.componentes.length === 0 ? (
                <div style={{ ...s.empty, padding: 24 }}>Agrega los insumos de una tanda.</div>
              ) : (
                <div style={s.card}>
                  <div style={s.tableHeadReceta}><span>Insumo</span><span>Cantidad por tanda</span><span></span></div>
                  {formReceta.componentes.map((c, idx) => (
                    <div key={c.inventario_id} style={s.tableRowReceta}>
                      <span>{c.nombre} <span style={s.muted}>({c.unidad})</span></span>
                      <input style={s.input} type="number" min={0} step="any" value={c.cantidad}
                        onChange={e => cambiarComponente(idx, e.target.value)} />
                      <button type="button" onClick={() => quitarComponente(idx)} style={s.dangerBtn}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>{guardando ? 'Guardando…' : 'Guardar receta'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: ASIGNAR / TRANSFERIR */}
      {(modal === 'asignar' || modal === 'transferir') && mov && (
        <Modal titulo={modal === 'asignar' ? `Asignar ${mov.producto}` : `Transferir ${mov.producto}`} cerrar={() => setModal(null)} ancho={480}>
          <form onSubmit={guardarMovimiento}>
            <p style={s.muted}>
              {modal === 'asignar'
                ? `Sin ubicación: ${num(mov.max)} ${mov.unidad}`
                : `Desde ${mov.origen_codigo}: ${num(mov.max)} ${mov.unidad} disponibles`}
            </p>
            <div style={{ display: 'grid', gap: 12 }}>
              <Campo label={modal === 'asignar' ? 'Ubicación' : 'Ubicación de destino'}>
                <select style={s.input} value={mov.ubicacion_id} onChange={e => setMov(m => ({ ...m, ubicacion_id: e.target.value }))} required>
                  <option value="">Elige una ubicación</option>
                  {ubicaciones
                    .filter(u => modal === 'asignar' || u.id !== mov.origen_id)
                    .map(u => <option key={u.id} value={u.id}>{etiquetaUbicacion(u)}</option>)}
                </select>
              </Campo>
              <Campo label={`Cantidad (${mov.unidad})`}>
                <input style={s.input} type="number" min={0} max={mov.max} step="any" value={mov.cantidad}
                  onChange={e => setMov(m => ({ ...m, cantidad: e.target.value }))} required />
              </Campo>
            </div>
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>{guardando ? 'Guardando…' : 'Confirmar'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Componentes ────────────────────────────────────────────────────────────

function Campo({ label, children }) {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

function Modal({ titulo, cerrar, children, ancho = 600 }) {
  return (
    <div style={s.overlay}>
      <div style={{ ...s.modal, maxWidth: ancho }}>
        <div style={s.modalHeader}>
          <h2 style={s.modalTitle}>{titulo}</h2>
          <button onClick={cerrar} style={s.closeModalBtn}>×</button>
        </div>
        <div style={s.modalBody}>{children}</div>
      </div>
    </div>
  )
}

// ── Estilos ────────────────────────────────────────────────────────────────

const s = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { margin: 0, fontSize: 26, fontWeight: 600, color: '#0f172a' },
  subtitle: { margin: '5px 0 0', color: '#64748b', fontSize: 14 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },

  primaryBtn: { border: 'none', background: '#0f172a', color: '#fff', padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  secondaryBtn: { background: '#fff', border: '1px solid #cbd5e1', color: '#334155', padding: '8px 13px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  actionBtn: { background: '#fff', border: '1px solid #cbd5e1', color: '#334155', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  dangerBtn: { background: '#fff', border: '1px solid #fecaca', color: '#dc2626', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 14 },
  dangerTextBtn: { background: '#fff', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 13px', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginRight: 'auto' },
  almacenBtn: { display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', marginBottom: 6, cursor: 'pointer', fontSize: 13, color: '#334155' },
  almacenBtnActivo: { borderColor: '#0f172a', background: '#f8fafc', color: '#0f172a' },

  errorBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  closeBtn: { border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 },

  tabs: { display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 20 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 14, color: '#64748b', marginBottom: -1 },
  tabActive: { borderBottomColor: '#0f172a', color: '#0f172a', fontWeight: 600 },

  filters: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff' },
  select: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff', minWidth: 200 },
  counter: { marginLeft: 'auto', color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },

  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14 },
  panelTitle: { fontWeight: 700, color: '#334155', marginBottom: 10, fontSize: 14 },
  chip: { background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: '#334155' },
  tableHeadOrdenes: { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr 1.2fr .6fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowOrdenes: { display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 2fr 1.2fr .6fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadDetalle: { display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.4fr 1.4fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowDetalle: { display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.4fr 1.4fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadReceta: { display: 'grid', gridTemplateColumns: '2fr 1.2fr .4fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowReceta: { display: 'grid', gridTemplateColumns: '2fr 1.2fr .4fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadStock: { display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr .8fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowStock: { display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.2fr .8fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 },
  recetaCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, width: 'fit-content' },
  muted: { color: '#94a3b8', fontSize: 12 },

  empty: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 50, textAlign: 'center', color: '#64748b' },
  loading: { padding: 40, textAlign: 'center', color: '#64748b' },

  formGrid2: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 },
  label: { display: 'block', fontSize: 12, color: '#475569', marginBottom: 5, fontWeight: 500 },

  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22, paddingTop: 16, borderTop: '1px solid #e2e8f0' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 },
  modal: { width: '100%', maxHeight: '92vh', background: '#fff', borderRadius: 9, boxShadow: '0 20px 50px rgba(0,0,0,.2)', overflow: 'hidden' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid #e2e8f0' },
  modalTitle: { margin: 0, fontSize: 18, color: '#0f172a' },
  closeModalBtn: { border: 'none', background: 'transparent', color: '#64748b', fontSize: 25, cursor: 'pointer' },
  modalBody: { padding: 20, overflowY: 'auto', maxHeight: 'calc(92vh - 65px)' },
}
