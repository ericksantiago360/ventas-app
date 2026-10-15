import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'

const api = axios.create({ baseURL: '' })
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

const TIPOS_MOV = [
  { value: 'entrada',              label: 'Entrada',               color: '#16a34a' },
  { value: 'salida',               label: 'Salida',                color: '#dc2626' },
  { value: 'ajuste',               label: 'Ajuste de inventario',  color: '#d97706' },
  { value: 'consignacion_salida',  label: 'Consignación (salida)', color: '#7c3aed' },
  { value: 'consignacion_entrada', label: 'Consignación (retorno)',color: '#2563eb' },
]

const UNIDADES = ['pza', 'kg', 'lt', 'caja', 'rollo', 'par', 'set', 'servicio', 'otro']

function money(v) {
  return Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function num(v, decimales = 2) {
  const n = Number(v || 0)
  return n % 1 === 0 ? n.toString() : n.toFixed(decimales)
}

function fecha(v) {
  if (!v) return '--'
  try { return new Date(v).toLocaleDateString('es-MX') } catch { return v }
}

function estadoStock(item) {
  const actual = Number(item.stock_actual || 0)
  const minimo = Number(item.stock_minimo || 0)
  if (actual === 0) return { label: 'Sin stock', color: '#dc2626', bg: '#fef2f2' }
  if (actual <= minimo) return { label: 'Stock bajo', color: '#d97706', bg: '#fffbeb' }
  return { label: 'Normal', color: '#16a34a', bg: '#f0fdf4' }
}

const emptyProducto = {
  nombre: '', sku: '', unidad: 'pza',
  stock_inicial: 0, stock_minimo: 0, stock_maximo: 0,
  ubicacion: '', costo_unitario: 0,
}

const emptyMovimiento = {
  tipo: 'entrada', cantidad: '', concepto: '', referencia: '', consignatario: '',
}

export default function Inventario() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [dashboard, setDashboard]   = useState(null)
  const [items, setItems]           = useState([])
  const [movimientos, setMovimientos] = useState([])

  const [cargando, setCargando]     = useState(false)
  const [error, setError]           = useState('')
  const [tab, setTab]               = useState('stock')
  const [busqueda, setBusqueda]     = useState('')
  const [soloAlertas, setSoloAlertas] = useState(false)

  const [modal, setModal]           = useState(null) // 'nuevo-producto' | 'editar-producto' | 'movimiento' | 'historial'
  const [itemSeleccionado, setItemSeleccionado] = useState(null)

  const [formProducto, setFormProducto]     = useState(emptyProducto)
  const [formMovimiento, setFormMovimiento] = useState(emptyMovimiento)
  const [guardando, setGuardando]           = useState(false)

  // ── Carga ────────────────────────────────────────────────────────────────

  const cargarTodo = async () => {
    setCargando(true)
    setError('')
    try {
      const [dashRes, stockRes, movsRes] = await Promise.all([
        api.get('/api/inventario/dashboard', { params: { negocio_id: negocioId } }),
        api.get('/api/inventario/stock',     { params: { negocio_id: negocioId } }),
        api.get('/api/inventario/movimientos', { params: { negocio_id: negocioId, limit: 200 } }),
      ])
      setDashboard(dashRes.data)
      setItems(stockRes.data || [])
      setMovimientos(movsRes.data || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al cargar el inventario.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargarTodo() }, [negocioId])

  // ── Filtros ───────────────────────────────────────────────────────────────

  const itemsFiltrados = useMemo(() => {
    let lista = items
    if (soloAlertas) lista = lista.filter(i => Number(i.stock_actual) <= Number(i.stock_minimo))
    if (busqueda.trim()) {
      const txt = busqueda.trim().toLowerCase()
      lista = lista.filter(i =>
        (i.nombre || '').toLowerCase().includes(txt) ||
        (i.sku   || '').toLowerCase().includes(txt)
      )
    }
    return lista
  }, [items, busqueda, soloAlertas])

  // ── Producto ──────────────────────────────────────────────────────────────

  const abrirNuevoProducto = () => {
    setFormProducto(emptyProducto)
    setItemSeleccionado(null)
    setModal('nuevo-producto')
  }

  const abrirEditarProducto = (item) => {
    setItemSeleccionado(item)
    setFormProducto({
      nombre: item.nombre || '',
      sku: item.sku || '',
      unidad: item.unidad || 'pza',
      stock_inicial: 0,
      stock_minimo: item.stock_minimo ?? 0,
      stock_maximo: item.stock_maximo ?? 0,
      ubicacion: item.ubicacion || '',
      costo_unitario: item.costo_unitario ?? 0,
    })
    setModal('editar-producto')
  }

  const guardarProducto = async (e) => {
    e.preventDefault()
    if (!formProducto.nombre.trim()) { setError('El nombre es requerido.'); return }
    setGuardando(true)
    setError('')
    try {
      if (itemSeleccionado) {
        await api.put(`/api/inventario/stock/${itemSeleccionado.id}`, {
          nombre: formProducto.nombre.trim(),
          sku: formProducto.sku.trim(),
          unidad: formProducto.unidad,
          stock_minimo: Number(formProducto.stock_minimo || 0),
          stock_maximo: Number(formProducto.stock_maximo || 0),
          ubicacion: formProducto.ubicacion.trim(),
          costo_unitario: Number(formProducto.costo_unitario || 0),
        })
      } else {
        await api.post('/api/inventario/stock', {
          negocio_id: negocioId,
          nombre: formProducto.nombre.trim(),
          sku: formProducto.sku.trim(),
          unidad: formProducto.unidad,
          stock_inicial: Number(formProducto.stock_inicial || 0),
          stock_minimo: Number(formProducto.stock_minimo || 0),
          stock_maximo: Number(formProducto.stock_maximo || 0),
          ubicacion: formProducto.ubicacion.trim(),
          costo_unitario: Number(formProducto.costo_unitario || 0),
        })
      }
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo guardar el producto.')
    } finally {
      setGuardando(false)
    }
  }

  const eliminarProducto = async (item) => {
    if (!window.confirm(`¿Eliminar "${item.nombre}" del inventario?`)) return
    try {
      await api.delete(`/api/inventario/stock/${item.id}`)
      await cargarTodo()
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo eliminar.')
    }
  }

  // ── Movimiento ────────────────────────────────────────────────────────────

  const abrirMovimiento = (item) => {
    setItemSeleccionado(item)
    setFormMovimiento(emptyMovimiento)
    setModal('movimiento')
  }

  const abrirHistorial = async (item) => {
    setItemSeleccionado(item)
    setModal('historial')
  }

  const guardarMovimiento = async (e) => {
    e.preventDefault()
    if (!formMovimiento.cantidad || Number(formMovimiento.cantidad) <= 0) {
      setError('Ingresa una cantidad válida.')
      return
    }
    setGuardando(true)
    setError('')
    try {
      await api.post(`/api/inventario/stock/${itemSeleccionado.id}/movimiento`, {
        tipo: formMovimiento.tipo,
        cantidad: Number(formMovimiento.cantidad),
        concepto: formMovimiento.concepto,
        referencia: formMovimiento.referencia,
        consignatario: formMovimiento.consignatario,
      })
      setModal(null)
      await cargarTodo()
    } catch (err) {
      setError(err.response?.data?.detail || 'No se pudo registrar el movimiento.')
    } finally {
      setGuardando(false)
    }
  }

  const movsDelItem = useMemo(() => {
    if (!itemSeleccionado) return []
    return movimientos.filter(m => m.inventario_id === itemSeleccionado.id)
  }, [movimientos, itemSeleccionado])

  const tipoMov = (tipo) => TIPOS_MOV.find(t => t.value === tipo)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* HEADER */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Inventario</h1>
          <p style={s.subtitle}>Control de stock y consignación</p>
        </div>
        <div style={s.headerActions}>
          <select
            value={negocioId}
            onChange={e => setNegocioId(e.target.value)}
            style={s.select}
          >
            {negociosDisponibles.map(n => (
              <option key={n.id} value={n.id}>{n.nombre}</option>
            ))}
          </select>
          <button onClick={abrirNuevoProducto} style={s.primaryBtn}>+ Nuevo producto</button>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      {/* CARDS RESUMEN */}
      {dashboard && (
        <div style={s.cards}>
          <Card titulo="Productos" valor={dashboard.total_productos} />
          <Card
            titulo="Stock bajo / sin stock"
            valor={`${dashboard.alertas_stock_bajo} / ${dashboard.sin_stock}`}
            alerta={dashboard.alertas_stock_bajo > 0}
          />
          <Card titulo="Valor del inventario" valor={money(dashboard.valor_total_inventario)} />
        </div>
      )}

      {/* TABS */}
      <div style={s.tabs}>
        {['stock', 'movimientos'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
          >
            {t === 'stock' ? 'Stock' : 'Historial de movimientos'}
          </button>
        ))}
      </div>

      {/* TAB STOCK */}
      {tab === 'stock' && (
        <>
          <div style={s.filters}>
            <input
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar producto o SKU..."
              style={{ ...s.input, maxWidth: 280 }}
            />
            <label style={s.checkLabel}>
              <input
                type="checkbox"
                checked={soloAlertas}
                onChange={e => setSoloAlertas(e.target.checked)}
              />
              {' '}Solo alertas
            </label>
            <button onClick={cargarTodo} style={s.secondaryBtn}>Actualizar</button>
            <span style={s.counter}>{itemsFiltrados.length} productos</span>
          </div>

          {cargando && items.length === 0 ? (
            <div style={s.loading}>Cargando inventario...</div>
          ) : itemsFiltrados.length === 0 ? (
            <div style={s.empty}>
              <p style={{ fontWeight: 600, fontSize: 16, margin: '0 0 8px' }}>
                {items.length === 0 ? 'No hay productos en el inventario' : 'Sin resultados'}
              </p>
              <p style={{ color: '#64748b', margin: 0 }}>
                {items.length === 0 ? 'Agrega el primer producto para comenzar.' : 'Prueba con otra búsqueda.'}
              </p>
              {items.length === 0 && (
                <button onClick={abrirNuevoProducto} style={{ ...s.primaryBtn, marginTop: 16 }}>
                  + Nuevo producto
                </button>
              )}
            </div>
          ) : (
            <div style={s.card}>
              <div style={s.tableHead}>
                <span>Producto</span>
                <span>SKU</span>
                <span>Stock actual</span>
                <span>Mínimo</span>
                <span>Unidad</span>
                <span>Costo u.</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>
              {itemsFiltrados.map(item => {
                const estado = estadoStock(item)
                return (
                  <div key={item.id} style={s.tableRow}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{item.nombre}</div>
                      {item.ubicacion && <div style={s.muted}>{item.ubicacion}</div>}
                    </div>
                    <div style={s.muted}>{item.sku || '--'}</div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {num(item.stock_actual)} <span style={s.muted}>{item.unidad}</span>
                    </div>
                    <div style={s.muted}>{num(item.stock_minimo)}</div>
                    <div style={s.muted}>{item.unidad}</div>
                    <div>{money(item.costo_unitario)}</div>
                    <span style={{ ...s.badge, background: estado.bg, color: estado.color }}>
                      {estado.label}
                    </span>
                    <div style={s.actions}>
                      <button onClick={() => abrirMovimiento(item)} style={s.actionBtn}>
                        + Movimiento
                      </button>
                      <button onClick={() => abrirHistorial(item)} style={s.actionBtn}>
                        Historial
                      </button>
                      <button onClick={() => abrirEditarProducto(item)} style={s.actionBtn}>
                        Editar
                      </button>
                      <button onClick={() => eliminarProducto(item)} style={s.dangerBtn}>
                        ×
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* TAB MOVIMIENTOS */}
      {tab === 'movimientos' && (
        <>
          <div style={s.filters}>
            <button onClick={cargarTodo} style={s.secondaryBtn}>Actualizar</button>
            <span style={s.counter}>{movimientos.length} movimientos</span>
          </div>
          {movimientos.length === 0 ? (
            <div style={s.empty}>
              <p style={{ margin: 0 }}>Sin movimientos registrados.</p>
            </div>
          ) : (
            <div style={s.card}>
              <div style={{ ...s.tableHead, gridTemplateColumns: '1fr 1.4fr 1.2fr .7fr 1.2fr 1.8fr' }}>
                <span>Fecha</span>
                <span>Producto</span>
                <span>Tipo</span>
                <span>Cantidad</span>
                <span>Stock ant → nuevo</span>
                <span>Concepto / Referencia</span>
              </div>
              {movimientos.map((mov, idx) => {
                const tipo = tipoMov(mov.tipo)
                return (
                  <div
                    key={mov.id || idx}
                    style={{ ...s.tableRow, gridTemplateColumns: '1fr 1.4fr 1.2fr .7fr 1.2fr 1.8fr' }}
                  >
                    <div style={s.muted}>{fecha(mov.fecha)}</div>
                    <div style={{ fontWeight: 500 }}>{mov.producto_nombre}</div>
                    <span style={{ ...s.badge, color: tipo?.color || '#64748b', background: `${tipo?.color || '#64748b'}18` }}>
                      {tipo?.label || mov.tipo}
                    </span>
                    <div style={{ fontWeight: 700 }}>
                      {mov.tipo === 'ajuste'
                        ? `→ ${num(mov.stock_nuevo)}`
                        : `${mov.tipo.startsWith('salida') || mov.tipo === 'consignacion_salida' ? '-' : '+'}${num(mov.cantidad)}`}
                    </div>
                    <div style={s.muted}>
                      {num(mov.stock_anterior)} → {num(mov.stock_nuevo)}
                    </div>
                    <div>
                      <div>{mov.concepto || '--'}</div>
                      {mov.referencia && <div style={s.muted}>{mov.referencia}</div>}
                      {mov.consignatario && <div style={s.muted}>Consignatario: {mov.consignatario}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── MODAL NUEVO / EDITAR PRODUCTO ── */}
      {(modal === 'nuevo-producto' || modal === 'editar-producto') && (
        <Modal
          titulo={modal === 'editar-producto' ? `Editar: ${itemSeleccionado?.nombre}` : 'Nuevo producto'}
          cerrar={() => setModal(null)}
        >
          <form onSubmit={guardarProducto}>
            <div style={s.formGrid2}>
              <Campo label="Nombre *">
                <input style={s.input} value={formProducto.nombre}
                  onChange={e => setFormProducto(p => ({ ...p, nombre: e.target.value }))}
                  placeholder="Ej. Pastel de chocolate" />
              </Campo>
              <Campo label="SKU / Código">
                <input style={s.input} value={formProducto.sku}
                  onChange={e => setFormProducto(p => ({ ...p, sku: e.target.value }))}
                  placeholder="Ej. DT-001" />
              </Campo>
              <Campo label="Unidad">
                <select style={s.input} value={formProducto.unidad}
                  onChange={e => setFormProducto(p => ({ ...p, unidad: e.target.value }))}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </Campo>
              <Campo label="Costo unitario">
                <input style={s.input} type="number" min="0" step="0.01" value={formProducto.costo_unitario}
                  onChange={e => setFormProducto(p => ({ ...p, costo_unitario: e.target.value }))} />
              </Campo>
              {modal === 'nuevo-producto' && (
                <Campo label="Stock inicial">
                  <input style={s.input} type="number" min="0" step="0.01" value={formProducto.stock_inicial}
                    onChange={e => setFormProducto(p => ({ ...p, stock_inicial: e.target.value }))} />
                </Campo>
              )}
              <Campo label="Stock mínimo (alerta)">
                <input style={s.input} type="number" min="0" step="0.01" value={formProducto.stock_minimo}
                  onChange={e => setFormProducto(p => ({ ...p, stock_minimo: e.target.value }))} />
              </Campo>
              <Campo label="Stock máximo">
                <input style={s.input} type="number" min="0" step="0.01" value={formProducto.stock_maximo}
                  onChange={e => setFormProducto(p => ({ ...p, stock_maximo: e.target.value }))} />
              </Campo>
              <Campo label="Ubicación">
                <input style={s.input} value={formProducto.ubicacion}
                  onChange={e => setFormProducto(p => ({ ...p, ubicacion: e.target.value }))}
                  placeholder="Ej. Almacén A, Estante 3" />
              </Campo>
            </div>
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL MOVIMIENTO ── */}
      {modal === 'movimiento' && itemSeleccionado && (
        <Modal titulo={`Movimiento — ${itemSeleccionado.nombre}`} cerrar={() => setModal(null)}>
          <div style={{ marginBottom: 16, padding: '10px 14px', background: '#f8fafc', borderRadius: 6 }}>
            <span style={s.muted}>Stock actual: </span>
            <strong>{num(itemSeleccionado.stock_actual)} {itemSeleccionado.unidad}</strong>
            {Number(itemSeleccionado.stock_minimo) > 0 && (
              <span style={s.muted}> · Mínimo: {num(itemSeleccionado.stock_minimo)}</span>
            )}
          </div>
          <form onSubmit={guardarMovimiento}>
            <div style={s.formGrid2}>
              <Campo label="Tipo de movimiento" full>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {TIPOS_MOV.map(t => (
                    <button
                      key={t.value} type="button"
                      onClick={() => setFormMovimiento(m => ({ ...m, tipo: t.value }))}
                      style={{
                        padding: '7px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
                        border: `2px solid ${formMovimiento.tipo === t.value ? t.color : '#e2e8f0'}`,
                        background: formMovimiento.tipo === t.value ? `${t.color}15` : '#fff',
                        color: formMovimiento.tipo === t.value ? t.color : '#475569',
                        fontWeight: formMovimiento.tipo === t.value ? 600 : 400,
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </Campo>
              <Campo label={formMovimiento.tipo === 'ajuste' ? 'Nuevo stock total' : 'Cantidad'}>
                <input style={s.input} type="number" min="0.01" step="0.01" value={formMovimiento.cantidad}
                  onChange={e => setFormMovimiento(m => ({ ...m, cantidad: e.target.value }))}
                  placeholder="0" autoFocus />
              </Campo>
              <Campo label="Concepto">
                <input style={s.input} value={formMovimiento.concepto}
                  onChange={e => setFormMovimiento(m => ({ ...m, concepto: e.target.value }))}
                  placeholder="Ej. Compra a proveedor" />
              </Campo>
              <Campo label="Referencia (opcional)">
                <input style={s.input} value={formMovimiento.referencia}
                  onChange={e => setFormMovimiento(m => ({ ...m, referencia: e.target.value }))}
                  placeholder="Folio, pedido, etc." />
              </Campo>
              {(formMovimiento.tipo === 'consignacion_salida' || formMovimiento.tipo === 'consignacion_entrada') && (
                <Campo label="Consignatario">
                  <input style={s.input} value={formMovimiento.consignatario}
                    onChange={e => setFormMovimiento(m => ({ ...m, consignatario: e.target.value }))}
                    placeholder="Nombre del punto de venta" />
                </Campo>
              )}
            </div>
            {formMovimiento.tipo === 'ajuste' && (
              <p style={{ ...s.muted, marginTop: 8, fontSize: 12 }}>
                El ajuste establece el stock al valor exacto que ingreses.
              </p>
            )}
            <div style={s.modalFooter}>
              <button type="button" onClick={() => setModal(null)} style={s.secondaryBtn}>Cancelar</button>
              <button type="submit" disabled={guardando} style={s.primaryBtn}>
                {guardando ? 'Registrando...' : 'Registrar movimiento'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL HISTORIAL ── */}
      {modal === 'historial' && itemSeleccionado && (
        <Modal titulo={`Historial — ${itemSeleccionado.nombre}`} cerrar={() => setModal(null)} ancho={740}>
          <div style={{ marginBottom: 12 }}>
            <strong>Stock actual: </strong>
            {num(itemSeleccionado.stock_actual)} {itemSeleccionado.unidad}
            <button
              onClick={() => { setModal(null); setTimeout(() => abrirMovimiento(itemSeleccionado), 50) }}
              style={{ ...s.primaryBtn, marginLeft: 12 }}
            >
              + Nuevo movimiento
            </button>
          </div>
          {movsDelItem.length === 0 ? (
            <p style={s.muted}>Sin movimientos registrados para este producto.</p>
          ) : (
            <div style={s.card}>
              {movsDelItem.map((mov, idx) => {
                const tipo = tipoMov(mov.tipo)
                return (
                  <div key={mov.id || idx} style={{ ...s.tableRow, gridTemplateColumns: '1fr 1.4fr .8fr 1.2fr 1fr', borderBottom: '1px solid #f1f5f9', padding: '10px 14px' }}>
                    <div style={s.muted}>{fecha(mov.fecha)}</div>
                    <span style={{ ...s.badge, color: tipo?.color || '#64748b', background: `${tipo?.color || '#64748b'}18` }}>
                      {tipo?.label || mov.tipo}
                    </span>
                    <div style={{ fontWeight: 700 }}>
                      {mov.tipo === 'ajuste' ? `→ ${num(mov.stock_nuevo)}` : `${mov.tipo.includes('salida') ? '-' : '+'}${num(mov.cantidad)}`}
                    </div>
                    <div style={s.muted}>{num(mov.stock_anterior)} → {num(mov.stock_nuevo)}</div>
                    <div style={{ fontSize: 12 }}>
                      <div>{mov.concepto || '--'}</div>
                      {mov.consignatario && <div style={s.muted}>{mov.consignatario}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Modal>
      )}

    </div>
  )
}

// ── Componentes auxiliares ─────────────────────────────────────────────────

function Card({ titulo, valor, alerta }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${alerta ? '#fecaca' : '#e2e8f0'}`,
      borderRadius: 8,
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {titulo}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: alerta ? '#dc2626' : '#0f172a' }}>
        {valor}
      </div>
    </div>
  )
}

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

  errorBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  closeBtn: { border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 },

  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 },

  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', padding: '8px 16px', cursor: 'pointer', fontSize: 14, color: '#64748b', marginBottom: -1 },
  tabActive: { borderBottomColor: '#0f172a', color: '#0f172a', fontWeight: 600 },

  filters: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
  input: { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, outline: 'none', background: '#fff' },
  select: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff', minWidth: 200 },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#334155', cursor: 'pointer', whiteSpace: 'nowrap' },
  counter: { marginLeft: 'auto', color: '#64748b', fontSize: 13, whiteSpace: 'nowrap' },

  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  tableHead: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr .8fr .7fr 1fr 1fr 1.8fr', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr .8fr .7fr 1fr 1fr 1.8fr', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' },
  actions: { display: 'flex', gap: 5, flexWrap: 'wrap' },
  badge: { display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 },
  muted: { color: '#94a3b8', fontSize: 12 },

  loading: { padding: 40, textAlign: 'center', color: '#64748b' },
  empty: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 50, textAlign: 'center', color: '#64748b' },

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
