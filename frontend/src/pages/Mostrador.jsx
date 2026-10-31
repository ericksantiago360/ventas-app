import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const METODOS = [
  { value: 'efectivo',      label: 'Efectivo',      color: '#16a34a' },
  { value: 'tarjeta',       label: 'Tarjeta',       color: '#2563eb' },
  { value: 'transferencia', label: 'Transferencia', color: '#7c3aed' },
]
const metodoInfo = (v) => METODOS.find(m => m.value === v) || METODOS[0]

function money(v) {
  return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function hoyLocal() {
  return new Date().toLocaleDateString('en-CA')
}

function hora(v) {
  if (!v) return '--'
  try { return new Date(v).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) } catch { return v }
}

// Mismo criterio que el backend: un solo tramo por línea, el de cantidad mínima más alta que se alcance
function precioConDescuento(precio, cantidad, tramos) {
  const aplicables = tramos.filter(t => t.activo !== false && t.cantidad_minima <= cantidad)
  const tramo = aplicables.reduce((mejor, t) => (!mejor || t.cantidad_minima > mejor.cantidad_minima ? t : mejor), null)
  const pct = tramo ? Number(tramo.porcentaje) : 0
  return { pct, unitario: Math.round((precio * (1 - pct / 100)) * 100 + 1e-9) / 100 }
}

function mensajeError(err, fallback) {
  const detalle = err.response?.data?.detail
  if (Array.isArray(detalle)) return detalle.map(d => d.msg).join('. ') || fallback
  return detalle || fallback
}

export default function Mostrador() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [tab, setTab]               = useState('vender')
  const [productos, setProductos]   = useState([])
  const [cuentas, setCuentas]       = useState([])
  const [busqueda, setBusqueda]     = useState('')
  const [carrito, setCarrito]       = useState({}) // { producto_id: { producto, cantidad } }
  const [metodo, setMetodo]         = useState('efectivo')
  const [cuentaId, setCuentaId]     = useState('')
  const [recibido, setRecibido]     = useState('')
  const [cargando, setCargando]     = useState(false)
  const [guardando, setGuardando]   = useState(false)
  const [error, setError]           = useState('')
  const [ticket, setTicket]         = useState(null) // venta recién cobrada

  const [fecha, setFecha]           = useState(hoyLocal())
  const [ventas, setVentas]         = useState([])
  const [resumen, setResumen]       = useState(null)

  const [tramos, setTramos]         = useState([])
  const [formTramo, setFormTramo]   = useState({ nombre: '', cantidad_minima: '', porcentaje: '' })

  // ── Carga ────────────────────────────────────────────────────────────────

  const cargarProductos = async (texto = busqueda) => {
    try {
      const { data } = await api.get('/api/mostrador/productos', {
        params: { negocio_id: negocioId, busqueda: texto },
      })
      setProductos(data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar los productos.'))
    }
  }

  const cargarCuentas = async () => {
    try {
      const { data } = await api.get('/api/finanzas/cuentas', {
        params: { negocio_id: negocioId, activo: true },
      })
      setCuentas(data || [])
      setCuentaId(actual => (data || []).some(c => c.id === actual) ? actual : (data?.[0]?.id || ''))
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar las cuentas.'))
    }
  }

  const cargarTramos = async () => {
    try {
      const { data } = await api.get('/api/mostrador/descuentos-volumen', { params: { negocio_id: negocioId } })
      setTramos(data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar los descuentos.'))
    }
  }

  const cargarDia = async () => {
    setCargando(true)
    setError('')
    try {
      const [ventasRes, resumenRes] = await Promise.all([
        api.get('/api/mostrador/ventas', { params: { negocio_id: negocioId, fecha } }),
        api.get('/api/mostrador/resumen', { params: { negocio_id: negocioId, fecha } }),
      ])
      setVentas(ventasRes.data || [])
      setResumen(resumenRes.data)
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar las ventas.'))
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    setCarrito({})
    cargarProductos('')
    cargarCuentas()
    cargarTramos()
    setBusqueda('')
  }, [negocioId])

  useEffect(() => {
    if (tab === 'dia') cargarDia()
  }, [tab, fecha, negocioId])

  // Búsqueda con pausa para no pedir en cada tecla
  useEffect(() => {
    const t = setTimeout(() => cargarProductos(busqueda), 250)
    return () => clearTimeout(t)
  }, [busqueda, negocioId])

  // ── Carrito ───────────────────────────────────────────────────────────────

  const agregar = (p) => {
    if (p.control_inventario && p.stock !== null && (carrito[p.id]?.cantidad || 0) >= p.stock) {
      setError(`Stock insuficiente de ${p.nombre}. Disponible: ${p.stock}`)
      return
    }
    setError('')
    setCarrito(c => ({
      ...c,
      [p.id]: { producto: p, cantidad: (c[p.id]?.cantidad || 0) + 1 },
    }))
  }

  const cambiarCantidad = (id, cantidad) => {
    setCarrito(c => {
      const linea = c[id]
      if (!linea) return c
      if (cantidad <= 0) {
        const { [id]: _, ...resto } = c
        return resto
      }
      return { ...c, [id]: { ...linea, cantidad } }
    })
  }

  const lineas = useMemo(() => Object.values(carrito), [carrito])
  const total = useMemo(
    () => lineas.reduce((n, l) => n + precioConDescuento(l.producto.precio, l.cantidad, tramos).unitario * l.cantidad, 0),
    [lineas, tramos]
  )

  // ── Descuentos por volumen ────────────────────────────────────────────────

  const guardarTramo = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/api/mostrador/descuentos-volumen', {
        negocio_id: negocioId,
        nombre: formTramo.nombre,
        cantidad_minima: Number(formTramo.cantidad_minima),
        porcentaje: Number(formTramo.porcentaje),
      })
      setFormTramo({ nombre: '', cantidad_minima: '', porcentaje: '' })
      await cargarTramos()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el tramo.'))
    }
  }

  const alternarTramo = async (t) => {
    setError('')
    try {
      await api.put(`/api/mostrador/descuentos-volumen/${t.id}`, { activo: !t.activo })
      await cargarTramos()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo actualizar el tramo.'))
    }
  }
  const cambio = metodo === 'efectivo' && recibido !== '' ? Number(recibido) - total : 0

  // ── Cobro ─────────────────────────────────────────────────────────────────

  const cobrar = async () => {
    setError('')
    if (lineas.length === 0) { setError('Agrega productos a la venta.'); return }
    if (!cuentaId) { setError('No hay una cuenta financiera activa para cobrar.'); return }
    if (metodo === 'efectivo' && (recibido === '' || Number(recibido) < total)) {
      setError(`El monto recibido debe ser al menos ${money(total)}.`)
      return
    }

    setGuardando(true)
    try {
      const { data } = await api.post('/api/mostrador/ventas', {
        negocio_id: negocioId,
        cuenta_id: cuentaId,
        metodo_pago: metodo,
        items: lineas.map(l => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
        monto_recibido: metodo === 'efectivo' ? Number(recibido) : null,
      })
      setTicket(data)
      setCarrito({})
      setRecibido('')
      await cargarProductos(busqueda)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo registrar la venta.'))
      await cargarProductos(busqueda)
    } finally {
      setGuardando(false)
    }
  }

  // ── Cancelación (ventas del día) ──────────────────────────────────────────

  const cancelarVenta = async (venta) => {
    const motivo = window.prompt(`Motivo para cancelar ${venta.folio}:`)
    if (!motivo || !motivo.trim()) return
    try {
      await api.post(`/api/mostrador/ventas/${venta.id}/cancelar`, { motivo: motivo.trim() })
      await cargarDia()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo cancelar la venta.'))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Mostrador</h1>
          <p style={s.subtitle}>Ventas de caja: cobro y entrega en el momento</p>
        </div>
        <div style={s.headerActions}>
          <select value={negocioId} onChange={e => setNegocioId(e.target.value)} style={s.select}>
            {negociosDisponibles.map(n => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      <div style={s.tabs}>
        {[['vender', 'Vender'], ['dia', 'Ventas del día'], ['descuentos', 'Descuentos por volumen']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{ ...s.tab, ...(tab === v ? s.tabActive : {}) }}>
            {l}
          </button>
        ))}
      </div>

      {/* VENDER */}
      {tab === 'vender' && (
        <div style={s.venderGrid}>
          {/* Productos */}
          <div>
            <input
              style={{ ...s.input, marginBottom: 14 }}
              placeholder="Buscar por nombre o código…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoFocus
            />
            {productos.length === 0 ? (
              <div style={s.empty}>No hay productos que coincidan.</div>
            ) : (
              <div style={s.productosGrid}>
                {productos.map(p => {
                  const enCarrito = carrito[p.id]?.cantidad || 0
                  const agotado = p.control_inventario && p.stock !== null && p.stock <= 0
                  return (
                    <button
                      key={p.id}
                      onClick={() => agregar(p)}
                      disabled={agotado}
                      style={{ ...s.productoCard, opacity: agotado ? 0.5 : 1 }}
                    >
                      <span style={s.productoNombre}>{p.nombre}</span>
                      <span style={s.productoPrecio}>{money(p.precio)}</span>
                      <span style={s.muted}>
                        {p.control_inventario ? `Stock: ${p.stock}` : 'Sin control de stock'}
                        {enCarrito > 0 && <strong style={{ color: '#0f172a' }}> · En venta: {enCarrito}</strong>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Venta en curso */}
          <div style={s.ventaPanel}>
            <h2 style={s.panelTitle}>Venta en curso</h2>

            {lineas.length === 0 ? (
              <div style={{ ...s.muted, padding: '20px 0' }}>Toca un producto para agregarlo.</div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                {lineas.map(l => (
                  <div key={l.producto.id} style={s.lineaRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.lineaNombre}>{l.producto.nombre}</div>
                      {(() => {
                        const { pct, unitario } = precioConDescuento(l.producto.precio, l.cantidad, tramos)
                        return (
                          <div style={s.muted}>
                            {pct > 0
                              ? <><span style={{ textDecoration: 'line-through' }}>{money(l.producto.precio)}</span> {money(unitario)} c/u · <strong style={{ color: '#16a34a' }}>−{pct}%</strong></>
                              : <>{money(l.producto.precio)} c/u</>}
                          </div>
                        )
                      })()}
                    </div>
                    <div style={s.qtyBox}>
                      <button onClick={() => cambiarCantidad(l.producto.id, l.cantidad - 1)} style={s.qtyBtn}>−</button>
                      <span style={{ minWidth: 26, textAlign: 'center' }}>{l.cantidad}</span>
                      <button onClick={() => agregar(l.producto)} style={s.qtyBtn}>+</button>
                    </div>
                    <div style={{ width: 84, textAlign: 'right', fontWeight: 600 }}>
                      {money(precioConDescuento(l.producto.precio, l.cantidad, tramos).unitario * l.cantidad)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={s.totalRow}>
              <span>Total (IVA incluido)</span>
              <strong style={{ fontSize: 22, color: '#0f172a' }}>{money(total)}</strong>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={s.label}>Método de pago</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {METODOS.map(m => (
                  <button
                    key={m.value} onClick={() => setMetodo(m.value)}
                    style={{
                      ...s.metodoBtn,
                      border: `2px solid ${metodo === m.value ? m.color : '#e2e8f0'}`,
                      background: metodo === m.value ? `${m.color}15` : '#fff',
                      color: metodo === m.value ? m.color : '#475569',
                      fontWeight: metodo === m.value ? 600 : 400,
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <label style={s.label}>Cuenta donde entra el dinero</label>
              <select style={{ ...s.input, marginBottom: 14 }} value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
                {cuentas.length === 0 && <option value="">Sin cuentas activas</option>}
                {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>

              {metodo === 'efectivo' && (
                <>
                  <label style={s.label}>Monto recibido</label>
                  <input
                    style={{ ...s.input, marginBottom: 8 }} type="number" min={0} step="0.01"
                    value={recibido} onChange={e => setRecibido(e.target.value)}
                  />
                  <div style={{ ...s.muted, marginBottom: 14, fontSize: 14 }}>
                    Cambio: <strong style={{ color: cambio < 0 ? '#dc2626' : '#16a34a' }}>
                      {recibido === '' ? '--' : money(Math.max(cambio, 0))}
                    </strong>
                  </div>
                </>
              )}

              <button
                onClick={cobrar}
                disabled={guardando || lineas.length === 0}
                style={{ ...s.cobrarBtn, opacity: guardando || lineas.length === 0 ? 0.5 : 1 }}
              >
                {guardando ? 'Cobrando…' : `Cobrar ${money(total)}`}
              </button>
              {lineas.length > 0 && (
                <button onClick={() => { setCarrito({}); setRecibido('') }} style={s.vaciarBtn}>Vaciar venta</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VENTAS DEL DÍA */}
      {tab === 'dia' && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <input style={{ ...s.input, width: 180 }} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
            <span style={s.counter}>{resumen ? `${resumen.ventas} ventas · ${resumen.canceladas} canceladas` : ''}</span>
          </div>

          {resumen && (
            <div style={s.cards}>
              <Card titulo="Total del día" valor={money(resumen.total)} destacado />
              {METODOS.map(m => (
                <Card
                  key={m.value}
                  titulo={`${m.label} (${resumen.por_metodo[m.value].cantidad})`}
                  valor={money(resumen.por_metodo[m.value].total)}
                />
              ))}
            </div>
          )}

          {cargando ? (
            <div style={s.loading}>Cargando…</div>
          ) : ventas.length === 0 ? (
            <div style={s.empty}>No hay ventas en este día.</div>
          ) : (
            <div style={s.card}>
              <div style={s.tableHead}>
                <span>Folio</span><span>Hora</span><span>Artículos</span><span>Método</span><span>Total</span><span>Estado</span><span></span>
              </div>
              {ventas.map(v => {
                const m = metodoInfo(v.metodo_pago)
                const cancelada = v.estado === 'cancelada'
                const piezas = v.items.reduce((n, i) => n + i.cantidad, 0)
                return (
                  <div key={v.id} style={{ ...s.tableRow, opacity: cancelada ? 0.55 : 1 }}>
                    <strong>{v.folio}</strong>
                    <span>{hora(v.fecha)}</span>
                    <span>{piezas}</span>
                    <span style={{ ...s.badge, color: m.color, background: `${m.color}15` }}>{m.label}</span>
                    <span>{money(v.total)}</span>
                    <span style={{ ...s.badge, color: cancelada ? '#dc2626' : '#16a34a', background: cancelada ? '#fef2f2' : '#f0fdf4' }}>
                      {cancelada ? 'Cancelada' : 'Completada'}
                    </span>
                    <div>
                      {!cancelada && <button onClick={() => cancelarVenta(v)} style={s.dangerBtn}>Cancelar</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* DESCUENTOS POR VOLUMEN */}
      {tab === 'descuentos' && (
        <div style={s.venderGrid}>
          <div>
            <p style={{ ...s.muted, marginTop: 0 }}>
              Cuando una línea alcanza la cantidad mínima, se aplica el porcentaje de ese tramo a su precio.
              Si se alcanzan varios tramos, aplica solo el de cantidad mínima más alta; no se acumulan.
            </p>
            {tramos.length === 0 ? (
              <div style={s.empty}>Aún no hay tramos de descuento.</div>
            ) : (
              <div style={s.card}>
                <div style={s.tableHeadTramos}>
                  <span>Nombre</span><span>Desde</span><span>Descuento</span><span>Estado</span><span></span>
                </div>
                {tramos.map(t => (
                  <div key={t.id} style={{ ...s.tableRowTramos, opacity: t.activo ? 1 : 0.5 }}>
                    <span>{t.nombre}</span>
                    <span>{t.cantidad_minima} piezas</span>
                    <strong>{t.porcentaje}%</strong>
                    <span style={{ ...s.badge, color: t.activo ? '#16a34a' : '#64748b', background: t.activo ? '#f0fdf4' : '#f1f5f9' }}>
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </span>
                    <div>
                      <button onClick={() => alternarTramo(t)} style={s.actionBtn}>{t.activo ? 'Desactivar' : 'Activar'}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={guardarTramo} style={s.ventaPanel}>
            <h2 style={s.panelTitle}>Nuevo tramo</h2>
            <label style={s.label}>Nombre</label>
            <input style={{ ...s.input, marginBottom: 12 }} placeholder="Ej. Mayoreo" value={formTramo.nombre}
              onChange={e => setFormTramo(f => ({ ...f, nombre: e.target.value }))} required />
            <label style={s.label}>Desde (piezas de un mismo producto)</label>
            <input style={{ ...s.input, marginBottom: 12 }} type="number" min={2} step={1} value={formTramo.cantidad_minima}
              onChange={e => setFormTramo(f => ({ ...f, cantidad_minima: e.target.value }))} required />
            <label style={s.label}>Porcentaje de descuento</label>
            <input style={{ ...s.input, marginBottom: 16 }} type="number" min={0.01} max={99.99} step="0.01" value={formTramo.porcentaje}
              onChange={e => setFormTramo(f => ({ ...f, porcentaje: e.target.value }))} required />
            <button type="submit" style={s.cobrarBtn}>Agregar tramo</button>
          </form>
        </div>
      )}

      {/* TICKET DE LA VENTA RECIÉN COBRADA */}
      {ticket && (
        <div style={s.overlay} onClick={() => setTicket(null)}>
          <div style={s.ticket} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>Venta registrada</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>{ticket.folio}</div>
            </div>
            <div style={s.ticketRow}><span>Total</span><strong>{money(ticket.total)}</strong></div>
            <div style={s.ticketRow}><span>Método</span><span>{metodoInfo(ticket.metodo_pago).label}</span></div>
            {ticket.metodo_pago === 'efectivo' && (
              <>
                <div style={s.ticketRow}><span>Recibido</span><span>{money(ticket.monto_recibido)}</span></div>
                <div style={{ ...s.ticketRow, fontSize: 18, color: '#16a34a' }}><span>Cambio</span><strong>{money(ticket.cambio)}</strong></div>
              </>
            )}
            <button onClick={() => setTicket(null)} style={{ ...s.cobrarBtn, marginTop: 18 }}>Nueva venta</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Componentes ────────────────────────────────────────────────────────────

function Card({ titulo, valor, destacado }) {
  return (
    <div style={{ ...s.statCard, ...(destacado ? { background: '#0f172a' } : {}) }}>
      <div style={{ fontSize: 12, color: destacado ? '#94a3b8' : '#64748b', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: destacado ? '#fff' : '#0f172a' }}>{valor}</div>
    </div>
  )
}

// ── Estilos ────────────────────────────────────────────────────────────────

const s = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { margin: 0, fontSize: 26, fontWeight: 600, color: '#0f172a' },
  subtitle: { margin: '5px 0 0', color: '#64748b', fontSize: 14 },
  headerActions: { display: 'flex', gap: 8, alignItems: 'center' },

  errorBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  closeBtn: { border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 },

  tabs: { display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 20 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 14, color: '#64748b', marginBottom: -1 },
  tabActive: { borderBottomColor: '#0f172a', color: '#0f172a', fontWeight: 600 },

  venderGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 20, alignItems: 'start' },
  productosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 },
  productoCard: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, cursor: 'pointer', textAlign: 'left' },
  productoNombre: { fontSize: 14, fontWeight: 500, color: '#0f172a' },
  productoPrecio: { fontSize: 16, fontWeight: 700, color: '#0f172a' },

  ventaPanel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 18, position: 'sticky', top: 16 },
  panelTitle: { margin: '0 0 12px', fontSize: 16, color: '#0f172a' },
  lineaRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9' },
  lineaNombre: { fontSize: 13, color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  qtyBox: { display: 'flex', alignItems: 'center', gap: 6 },
  qtyBtn: { width: 28, height: 28, border: '1px solid #cbd5e1', background: '#fff', borderRadius: 5, cursor: 'pointer', fontSize: 16 },
  totalRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '2px solid #0f172a', color: '#475569', fontSize: 14 },
  metodoBtn: { padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  cobrarBtn: { width: '100%', border: 'none', background: '#0f172a', color: '#fff', padding: '12px 14px', borderRadius: 7, cursor: 'pointer', fontSize: 15, fontWeight: 600 },
  vaciarBtn: { width: '100%', marginTop: 8, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 },

  select: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff', minWidth: 200 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff' },
  label: { display: 'block', fontSize: 12, color: '#475569', marginBottom: 5, fontWeight: 500 },
  counter: { marginLeft: 'auto', color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },
  muted: { color: '#94a3b8', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 4 },

  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 },
  statCard: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 },

  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  tableHeadTramos: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr .8fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRowTramos: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr .8fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  actionBtn: { background: '#fff', border: '1px solid #cbd5e1', color: '#334155', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
  tableHead: { display: 'grid', gridTemplateColumns: '1fr .8fr .8fr 1.2fr 1fr 1.1fr .9fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRow: { display: 'grid', gridTemplateColumns: '1fr .8fr .8fr 1.2fr 1fr 1.1fr .9fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, width: 'fit-content' },
  dangerBtn: { background: '#fff', border: '1px solid #fecaca', color: '#dc2626', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },

  empty: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 40, textAlign: 'center', color: '#64748b' },
  loading: { padding: 40, textAlign: 'center', color: '#64748b' },

  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 },
  ticket: { width: '100%', maxWidth: 360, background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,.2)' },
  ticketRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14, color: '#334155' },
}
