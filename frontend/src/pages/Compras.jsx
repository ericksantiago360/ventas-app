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
  { value: 'borrador',         label: 'Borrador',          color: '#64748b', bg: '#f1f5f9' },
  { value: 'enviada',          label: 'Enviada',           color: '#2563eb', bg: '#eff6ff' },
  { value: 'recibida_parcial', label: 'Recibida parcial',  color: '#d97706', bg: '#fffbeb' },
  { value: 'recibida',         label: 'Recibida',          color: '#16a34a', bg: '#f0fdf4' },
  { value: 'cancelada',        label: 'Cancelada',         color: '#dc2626', bg: '#fef2f2' },
]
const estadoInfo = (v) => ESTADOS.find(e => e.value === v) || ESTADOS[0]

const TOLERANCIA = 1e-9

function money(v) {
  return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function num(v) {
  const n = Number(v || 0)
  return n % 1 === 0 ? n.toString() : n.toFixed(2)
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

const emptyProveedor = {
  nombre: '', rfc: '', contacto: '', telefono: '', email: '', dias_credito: 0, notas: '',
}

const emptyOrden = {
  proveedor_id: '', items: [], impuestos: 0, notas: '',
}

export default function Compras() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [proveedores, setProveedores] = useState([])
  const [ordenes, setOrdenes]         = useState([])
  const [productos, setProductos]     = useState([])
  const [cargando, setCargando]       = useState(false)
  const [error, setError]             = useState('')
  const [tab, setTab]                 = useState('ordenes')
  const [filtroEstado, setFiltroEstado] = useState('')

  const [modal, setModal]             = useState(null) // 'orden' | 'detalle' | 'recepcion' | 'proveedor'
  const [ordenActiva, setOrdenActiva] = useState(null)
  const [proveedorActivo, setProveedorActivo] = useState(null)
  const [formOrden, setFormOrden]     = useState(emptyOrden)
  const [formProveedor, setFormProveedor] = useState(emptyProveedor)
  const [recepcion, setRecepcion]     = useState({})
  const [guardando, setGuardando]     = useState(false)

  // ── Carga ────────────────────────────────────────────────────────────────

  const cargarTodo = async () => {
    setCargando(true)
    setError('')
    try {
      const [provRes, ordRes, stockRes] = await Promise.all([
        api.get('/api/compras/proveedores', { params: { negocio_id: negocioId } }),
        api.get('/api/compras/ordenes', { params: { negocio_id: negocioId } }),
        api.get('/api/inventario/stock', { params: { negocio_id: negocioId } }),
      ])
      setProveedores(provRes.data || [])
      setOrdenes(ordRes.data || [])
      setProductos(stockRes.data || [])
    } catch (err) {
      setError(mensajeError(err, 'Error al cargar compras.'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarTodo() }, [negocioId])

  const ordenesFiltradas = useMemo(
    () => filtroEstado ? ordenes.filter(o => o.estado === filtroEstado) : ordenes,
    [ordenes, filtroEstado]
  )

  const nombreProveedor = (id) => proveedores.find(p => p.id === id)?.nombre

  // ── Órdenes: alta y edición ───────────────────────────────────────────────

  const abrirNuevaOrden = () => {
    setOrdenActiva(null)
    setFormOrden({ ...emptyOrden, proveedor_id: proveedores[0]?.id || '' })
    setModal('orden')
  }

  const abrirEditarOrden = (orden) => {
    setOrdenActiva(orden)
    setFormOrden({
      proveedor_id: orden.proveedor_id,
      items: orden.items.map(i => ({
        inventario_id: i.inventario_id, nombre: i.nombre, unidad: i.unidad,
        cantidad: i.cantidad, costo_unitario: i.costo_unitario,
      })),
      impuestos: orden.impuestos ?? 0,
      notas: orden.notas || '',
    })
    setModal('orden')
  }

  const agregarLinea = (productoId) => {
    if (!productoId) return
    if (formOrden.items.some(i => i.inventario_id === productoId)) {
      setError('Ese producto ya está en la orden.')
      return
    }
    const p = productos.find(x => x.id === productoId)
    if (!p) return
    setFormOrden(f => ({
      ...f,
      items: [...f.items, {
        inventario_id: p.id, nombre: p.nombre, unidad: p.unidad,
        cantidad: 1, costo_unitario: p.costo_unitario ?? 0,
      }],
    }))
  }

  const actualizarLinea = (idx, campo, valor) => {
    setFormOrden(f => ({
      ...f,
      items: f.items.map((i, n) => n === idx ? { ...i, [campo]: valor } : i),
    }))
  }

  const quitarLinea = (idx) => {
    setFormOrden(f => ({ ...f, items: f.items.filter((_, n) => n !== idx) }))
  }

  const totalesForm = useMemo(() => {
    const subtotal = formOrden.items.reduce((n, i) => n + (Number(i.cantidad) || 0) * (Number(i.costo_unitario) || 0), 0)
    const impuestos = Number(formOrden.impuestos) || 0
    return { subtotal, impuestos, total: subtotal + impuestos }
  }, [formOrden])

  const guardarOrden = async (e) => {
    e.preventDefault()
    if (!formOrden.proveedor_id) { setError('Elige un proveedor.'); return }
    if (formOrden.items.length === 0) { setError('Agrega al menos un producto.'); return }
    const lineas = formOrden.items.map(i => ({
      inventario_id: i.inventario_id,
      cantidad: Number(i.cantidad),
      costo_unitario: Number(i.costo_unitario) || 0,
    }))
    if (lineas.some(l => !(l.cantidad > 0))) { setError('Las cantidades deben ser mayores que cero.'); return }

    setGuardando(true)
    setError('')
    try {
      if (ordenActiva) {
        await api.put(`/api/compras/ordenes/${ordenActiva.id}`, {
          proveedor_id: formOrden.proveedor_id,
          items: lineas,
          impuestos: Number(formOrden.impuestos) || 0,
          notas: formOrden.notas,
        })
      } else {
        await api.post('/api/compras/ordenes', {
          negocio_id: negocioId,
          proveedor_id: formOrden.proveedor_id,
          items: lineas,
          impuestos: Number(formOrden.impuestos) || 0,
          notas: formOrden.notas,
        })
      }
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar la orden.'))
    } finally {
      setGuardando(false)
    }
  }

  // ── Órdenes: detalle y acciones ───────────────────────────────────────────

  const abrirDetalle = async (orden) => {
    try {
      const { data } = await api.get(`/api/compras/ordenes/${orden.id}`)
      setOrdenActiva(data)
      setModal('detalle')
    } catch (err) {
      setError(mensajeError(err, 'No se pudo abrir la orden.'))
    }
  }

  const accionOrden = async (url, mensaje, body) => {
    setGuardando(true)
    setError('')
    try {
      const { data } = await api.post(url, body)
      // La respuesta del POST no trae el egreso vinculado: se vuelve a leer el detalle completo
      const { data: detalle } = await api.get(`/api/compras/ordenes/${data.id}`)
      setOrdenActiva(detalle)
      await cargarTodo()
      return detalle
    } catch (err) {
      setError(mensajeError(err, mensaje))
      return null
    } finally {
      setGuardando(false)
    }
  }

  const enviarOrden = async () => {
    if (!window.confirm(`¿Enviar la orden ${ordenActiva.numero} a ${ordenActiva.proveedor_nombre}?`)) return
    await accionOrden(`/api/compras/ordenes/${ordenActiva.id}/enviar`, 'No se pudo enviar la orden.')
  }

  const cancelarOrden = async () => {
    const motivo = window.prompt(`Motivo para cancelar ${ordenActiva.numero}:`)
    if (!motivo || !motivo.trim()) return
    const ok = await accionOrden(`/api/compras/ordenes/${ordenActiva.id}/cancelar`, 'No se pudo cancelar la orden.', { motivo: motivo.trim() })
    if (ok) setModal(null)
  }

  // ── Recepción ─────────────────────────────────────────────────────────────

  const abrirRecepcion = () => {
    const inicial = {}
    ordenActiva.items.forEach(i => {
      const pendiente = Number(i.cantidad) - Number(i.cantidad_recibida || 0)
      if (pendiente > TOLERANCIA) inicial[i.inventario_id] = String(pendiente)
    })
    setRecepcion(inicial)
    setModal('recepcion')
  }

  const registrarRecepcion = async (e) => {
    e.preventDefault()
    const lineas = Object.entries(recepcion)
      .map(([inventario_id, cantidad]) => ({ inventario_id, cantidad: Number(cantidad) }))
      .filter(l => l.cantidad > 0)
    if (lineas.length === 0) { setError('Indica al menos una cantidad recibida.'); return }

    const ok = await accionOrden(
      `/api/compras/ordenes/${ordenActiva.id}/recepcion`,
      'No se pudo registrar la recepción.',
      { items: lineas },
    )
    if (ok) setModal('detalle')
  }

  // ── Proveedores ───────────────────────────────────────────────────────────

  const abrirNuevoProveedor = () => {
    setProveedorActivo(null)
    setFormProveedor(emptyProveedor)
    setModal('proveedor')
  }

  const abrirEditarProveedor = (p) => {
    setProveedorActivo(p)
    setFormProveedor({
      nombre: p.nombre || '', rfc: p.rfc || '', contacto: p.contacto || '', telefono: p.telefono || '',
      email: p.email || '', dias_credito: p.dias_credito ?? 0, notas: p.notas || '',
    })
    setModal('proveedor')
  }

  const guardarProveedor = async (e) => {
    e.preventDefault()
    if (!formProveedor.nombre.trim()) { setError('El nombre es requerido.'); return }
    const cuerpo = { ...formProveedor, dias_credito: Number(formProveedor.dias_credito) || 0 }
    setGuardando(true)
    setError('')
    try {
      if (proveedorActivo) {
        await api.put(`/api/compras/proveedores/${proveedorActivo.id}`, cuerpo)
      } else {
        await api.post('/api/compras/proveedores', { ...cuerpo, negocio_id: negocioId })
      }
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el proveedor.'))
    } finally {
      setGuardando(false)
    }
  }

  const darDeBajaProveedor = async (p) => {
    if (!window.confirm(`¿Dar de baja a "${p.nombre}"? Sus órdenes existentes se conservan.`)) return
    try {
      await api.delete(`/api/compras/proveedores/${p.id}`)
      await cargarTodo()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo dar de baja el proveedor.'))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Compras</h1>
          <p style={s.subtitle}>Órdenes a proveedores y recepción de mercancía</p>
        </div>
        <div style={s.headerActions}>
          <select value={negocioId} onChange={e => setNegocioId(e.target.value)} style={s.select}>
            {negociosDisponibles.map(n => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>
          {tab === 'ordenes'
            ? <button onClick={abrirNuevaOrden} style={s.primaryBtn}>+ Nueva orden</button>
            : <button onClick={abrirNuevoProveedor} style={s.primaryBtn}>+ Nuevo proveedor</button>}
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      {/* TABS */}
      <div style={s.tabs}>
        {[['ordenes', 'Órdenes'], ['proveedores', 'Proveedores']].map(([v, l]) => (
          <button
            key={v} onClick={() => setTab(v)}
            style={{ ...s.tab, ...(tab === v ? s.tabActive : {}) }}
          >
            {l}
          </button>
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
            <div style={s.empty}>No hay órdenes de compra{filtroEstado ? ' en este estado' : ''}.</div>
          ) : (
            <div style={s.card}>
              <div style={s.tableHeadOrdenes}>
                <span>Folio</span><span>Proveedor</span><span>Estado</span><span>Total</span><span>Emisión</span><span></span>
              </div>
              {ordenesFiltradas.map(o => {
                const est = estadoInfo(o.estado)
                return (
                  <div key={o.id} style={s.tableRowOrdenes}>
                    <strong>{o.numero}</strong>
                    <span>{o.proveedor_nombre}</span>
                    <span style={{ ...s.badge, color: est.color, background: est.bg }}>{est.label}</span>
                    <span>{money(o.total)}</span>
                    <span style={s.muted}>{fecha(o.fecha_emision)}</span>
                    <div style={s.actions}>
                      <button onClick={() => abrirDetalle(o)} style={s.actionBtn}>Ver</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* PROVEEDORES */}
      {!cargando && tab === 'proveedores' && (
        proveedores.length === 0 ? (
          <div style={s.empty}>Aún no hay proveedores registrados.</div>
        ) : (
          <div style={s.card}>
            <div style={s.tableHeadProveedores}>
              <span>Nombre</span><span>Contacto</span><span>Teléfono</span><span>Crédito</span><span></span>
            </div>
            {proveedores.map(p => (
              <div key={p.id} style={s.tableRowProveedores}>
                <strong>{p.nombre}</strong>
                <span>{p.contacto || '--'}</span>
                <span>{p.telefono || '--'}</span>
                <span>{p.dias_credito ? `${p.dias_credito} días` : 'Contado'}</span>
                <div style={s.actions}>
                  <button onClick={() => abrirEditarProveedor(p)} style={s.actionBtn}>Editar</button>
                  <button onClick={() => darDeBajaProveedor(p)} style={s.dangerBtn}>×</button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* MODAL: ORDEN (alta / edición) */}
      {modal === 'orden' && (
        <Modal titulo={ordenActiva ? `Editar ${ordenActiva.numero}` : 'Nueva orden de compra'} cerrar={() => setModal(null)} ancho={760}>
          <form onSubmit={guardarOrden}>
            <div style={s.formGrid2}>
              <Campo label="Proveedor">
                <select style={s.input} value={formOrden.proveedor_id}
                  onChange={e => setFormOrden(f => ({ ...f, proveedor_id: e.target.value }))}>
                  <option value="">Elige un proveedor</option>
                  {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Agregar producto">
                <select style={s.input} value="" onChange={e => agregarLinea(e.target.value)}>
                  <option value="">Elige un producto…</option>
                  {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
            </div>

            <div style={{ marginTop: 16 }}>
              {formOrden.items.length === 0 ? (
                <div style={{ ...s.empty, padding: 24 }}>Agrega productos a la orden.</div>
              ) : (
                <div style={s.card}>
                  <div style={s.tableHeadLineas}>
                    <span>Producto</span><span>Cantidad</span><span>Costo unit.</span><span>Importe</span><span></span>
                  </div>
                  {formOrden.items.map((l, idx) => (
                    <div key={l.inventario_id} style={s.tableRowLineas}>
                      <span>{l.nombre} <span style={s.muted}>({l.unidad})</span></span>
                      <input style={s.input} type="number" min={0} step="any" value={l.cantidad}
                        onChange={e => actualizarLinea(idx, 'cantidad', e.target.value)} />
                      <input style={s.input} type="number" min={0} step="0.01" value={l.costo_unitario}
                        onChange={e => actualizarLinea(idx, 'costo_unitario', e.target.value)} />
                      <span>{money((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0))}</span>
                      <button type="button" onClick={() => quitarLinea(idx)} style={s.dangerBtn}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...s.formGrid2, marginTop: 16 }}>
              <Campo label="Impuestos (monto)">
                <input style={s.input} type="number" min={0} step="0.01" value={formOrden.impuestos}
                  onChange={e => setFormOrden(f => ({ ...f, impuestos: e.target.value }))} />
              </Campo>
              <Campo label="Notas">
                <input style={s.input} value={formOrden.notas}
                  onChange={e => setFormOrden(f => ({ ...f, notas: e.target.value }))} />
              </Campo>
            </div>

            <div style={{ textAlign: 'right', marginTop: 14, fontSize: 13, color: '#475569' }}>
              Subtotal {money(totalesForm.subtotal)} · Impuestos {money(totalesForm.impuestos)} ·{' '}
              <strong style={{ color: '#0f172a' }}>Total {money(totalesForm.total)}</strong>
            </div>

            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>
                {guardando ? 'Guardando…' : 'Guardar borrador'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: DETALLE */}
      {modal === 'detalle' && ordenActiva && (() => {
        const est = estadoInfo(ordenActiva.estado)
        const conRecepciones = ordenActiva.items.some(i => Number(i.cantidad_recibida) > 0)
        return (
          <Modal titulo={`${ordenActiva.numero} — ${ordenActiva.proveedor_nombre}`} cerrar={() => setModal(null)} ancho={760}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ ...s.badge, color: est.color, background: est.bg }}>{est.label}</span>
              <span style={s.muted}>Emitida {fecha(ordenActiva.fecha_emision)}</span>
              {ordenActiva.fecha_envio && <span style={s.muted}>· Enviada {fecha(ordenActiva.fecha_envio)}</span>}
              {ordenActiva.fecha_recepcion && <span style={s.muted}>· Última recepción {fecha(ordenActiva.fecha_recepcion)}</span>}
            </div>

            {ordenActiva.estado === 'cancelada' && (
              <div style={{ ...s.errorBox, background: '#fef2f2' }}>Motivo: {ordenActiva.motivo_cancelacion}</div>
            )}

            <div style={s.card}>
              <div style={s.tableHeadDetalle}>
                <span>Producto</span><span>Pedido</span><span>Recibido</span><span>Pendiente</span><span>Costo</span><span>Importe</span>
              </div>
              {ordenActiva.items.map(i => {
                const pendiente = Math.max(0, Number(i.cantidad) - Number(i.cantidad_recibida || 0))
                return (
                  <div key={i.inventario_id} style={s.tableRowDetalle}>
                    <span>{i.nombre}</span>
                    <span>{num(i.cantidad)} {i.unidad}</span>
                    <span>{num(i.cantidad_recibida)}</span>
                    <span style={{ color: pendiente > TOLERANCIA ? '#d97706' : '#16a34a' }}>{num(pendiente)}</span>
                    <span>{money(i.costo_unitario)}</span>
                    <span>{money(i.importe)}</span>
                  </div>
                )
              })}
            </div>

            <div style={{ textAlign: 'right', marginTop: 12, fontSize: 13, color: '#475569' }}>
              Subtotal {money(ordenActiva.subtotal)} · Impuestos {money(ordenActiva.impuestos)} ·{' '}
              <strong style={{ color: '#0f172a' }}>Total {money(ordenActiva.total)}</strong>
            </div>
            {ordenActiva.egreso && ordenActiva.egreso.estado !== 'anulado' && (
              <div style={{ textAlign: 'right', marginTop: 6, fontSize: 13 }}>
                <span style={{ color: '#475569' }}>💸 Registrado en Finanzas · </span>
                <a href={`/finanzas?ref=${ordenActiva.egreso.id}`} style={{ color: '#0d9488', fontWeight: 600 }}>Ver →</a>
              </div>
            )}
            {ordenActiva.notas && <p style={{ ...s.muted, marginTop: 10 }}>Notas: {ordenActiva.notas}</p>}

            <div style={s.modalFooter}>
              {ordenActiva.estado === 'borrador' && (
                <>
                  <button onClick={cancelarOrden} disabled={guardando} style={s.dangerTextBtn}>Cancelar orden</button>
                  <button onClick={() => abrirEditarOrden(ordenActiva)} style={s.secondaryBtn}>Editar</button>
                  <button onClick={enviarOrden} disabled={guardando} style={s.primaryBtn}>Enviar al proveedor</button>
                </>
              )}
              {ordenActiva.estado === 'enviada' && !conRecepciones && (
                <button onClick={cancelarOrden} disabled={guardando} style={s.dangerTextBtn}>Cancelar orden</button>
              )}
              {['enviada', 'recibida_parcial'].includes(ordenActiva.estado) && (
                <button onClick={abrirRecepcion} disabled={guardando} style={s.primaryBtn}>Registrar recepción</button>
              )}
            </div>
          </Modal>
        )
      })()}

      {/* MODAL: RECEPCIÓN */}
      {modal === 'recepcion' && ordenActiva && (
        <Modal titulo={`Recepción — ${ordenActiva.numero}`} cerrar={() => setModal('detalle')} ancho={640}>
          <p style={{ ...s.muted, marginTop: 0 }}>
            Indica lo que llegó en esta entrega. Cada cantidad suma al stock del producto.
          </p>
          <form onSubmit={registrarRecepcion}>
            <div style={s.card}>
              <div style={s.tableHeadRecepcion}>
                <span>Producto</span><span>Pendiente</span><span>Recibe ahora</span>
              </div>
              {ordenActiva.items.map(i => {
                const pendiente = Math.max(0, Number(i.cantidad) - Number(i.cantidad_recibida || 0))
                if (pendiente <= TOLERANCIA) return null
                return (
                  <div key={i.inventario_id} style={s.tableRowRecepcion}>
                    <span>{i.nombre} <span style={s.muted}>({i.unidad})</span></span>
                    <span>{num(pendiente)}</span>
                    <input style={s.input} type="number" min={0} max={pendiente} step="any"
                      value={recepcion[i.inventario_id] ?? ''}
                      onChange={e => setRecepcion(r => ({ ...r, [i.inventario_id]: e.target.value }))} />
                  </div>
                )
              })}
            </div>
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal('detalle')} style={s.secondaryBtn}>Volver</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>
                {guardando ? 'Registrando…' : 'Confirmar recepción'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* MODAL: PROVEEDOR */}
      {modal === 'proveedor' && (
        <Modal titulo={proveedorActivo ? 'Editar proveedor' : 'Nuevo proveedor'} cerrar={() => setModal(null)}>
          <form onSubmit={guardarProveedor}>
            <div style={s.formGrid2}>
              <Campo label="Nombre *" full>
                <input style={s.input} value={formProveedor.nombre}
                  onChange={e => setFormProveedor(f => ({ ...f, nombre: e.target.value }))} />
              </Campo>
              <Campo label="RFC">
                <input style={s.input} value={formProveedor.rfc}
                  onChange={e => setFormProveedor(f => ({ ...f, rfc: e.target.value }))} />
              </Campo>
              <Campo label="Contacto">
                <input style={s.input} value={formProveedor.contacto}
                  onChange={e => setFormProveedor(f => ({ ...f, contacto: e.target.value }))} />
              </Campo>
              <Campo label="Teléfono">
                <input style={s.input} value={formProveedor.telefono}
                  onChange={e => setFormProveedor(f => ({ ...f, telefono: e.target.value }))} />
              </Campo>
              <Campo label="Correo">
                <input style={s.input} type="email" value={formProveedor.email}
                  onChange={e => setFormProveedor(f => ({ ...f, email: e.target.value }))} />
              </Campo>
              <Campo label="Días de crédito">
                <input style={s.input} type="number" min={0} value={formProveedor.dias_credito}
                  onChange={e => setFormProveedor(f => ({ ...f, dias_credito: e.target.value }))} />
              </Campo>
              <Campo label="Notas" full>
                <input style={s.input} value={formProveedor.notas}
                  onChange={e => setFormProveedor(f => ({ ...f, notas: e.target.value }))} />
              </Campo>
            </div>
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── Componentes ────────────────────────────────────────────────────────────

function Campo({ label, children, full }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : {}}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

function Modal({ titulo, cerrar, children, ancho = 620 }) {
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

  errorBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  closeBtn: { border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 },

  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 14, color: '#64748b', marginBottom: -1 },
  tabActive: { borderBottomColor: '#0f172a', color: '#0f172a', fontWeight: 600 },

  filters: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff' },
  select: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff', minWidth: 200 },
  counter: { marginLeft: 'auto', color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },

  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  tableHeadOrdenes: { display: 'grid', gridTemplateColumns: '1fr 2fr 1.2fr 1fr 1fr .8fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowOrdenes: { display: 'grid', gridTemplateColumns: '1fr 2fr 1.2fr 1fr 1fr .8fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadProveedores: { display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowProveedores: { display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadLineas: { display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1fr .4fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowLineas: { display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1fr .4fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadDetalle: { display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowDetalle: { display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1fr 1fr 1fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  tableHeadRecepcion: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowRecepcion: { display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr', gap: 8, alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  actions: { display: 'flex', gap: 5, flexWrap: 'wrap' },
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
