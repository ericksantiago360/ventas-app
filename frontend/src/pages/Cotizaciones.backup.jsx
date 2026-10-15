import { useEffect, useMemo, useState } from 'react'
import { cotizacionesApi } from '../api/client'
import axios from 'axios'

const NEGOCIOS = [
  { id: 'santal', label: 'Santal Machinery' },
  { id: 'dulce_tentacion', label: 'Dulce Tentación' },
  { id: 'bienes_raices', label: 'Bienes Raíces' },
]

const ESTADOS = [
  ['borrador', 'Borrador'],
  ['enviada', 'Enviada'],
  ['aceptada', 'Aceptada'],
  ['rechazada', 'Rechazada'],
  ['vencida', 'Vencida'],
]

const api = axios.create({
  baseURL: '',
  timeout: 15000,
})

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

const emptyForm = {
  cliente_id: '',
  cliente_nombre: '',
  vigencia_dias: 15,
  iva_aplicable: true,
  iva_pct: 16,
  descuento_pct: 0,
  notas: '',
}

export default function Cotizaciones() {
  const [negocio, setNegocio] = useState(
    localStorage.getItem('negocio_id') || 'santal'
  )

  const [cotizaciones, setCotizaciones] = useState([])
  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])

  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [busquedaProducto, setBusquedaProducto] = useState('')

  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([])

  const [loading, setLoading] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    cargarCotizaciones()
  }, [negocio])

  useEffect(() => {
    if (modal === 'nueva') {
      cargarClientes()
      cargarProductos()
    }
  }, [modal, negocio])

  async function cargarCotizaciones() {
    setLoading(true)
    setError('')

    try {
      const res = await cotizacionesApi.listar({
        negocio_id: negocio,
        page: 1,
        limit: 100,
      })

      setCotizaciones(res.data.data || [])
    } catch (err) {
      console.error(err)
      setError(
        err.response?.data?.detail ||
        'No se pudieron cargar las cotizaciones'
      )
    } finally {
      setLoading(false)
    }
  }

  async function cargarClientes() {
    try {
      const res = await api.get('/api/crm/clientes', {
        params: {
          negocio_id: negocio,
          q: busquedaCliente || undefined,
          activo: true,
          limit: 100,
        },
      })

      setClientes(res.data.data || [])
    } catch (err) {
      console.error(err)
      setError(
        err.response?.data?.detail ||
        'No se pudieron cargar los clientes'
      )
    }
  }

  async function cargarProductos() {
    try {
      const res = await api.get('/api/catalogo/productos', {
        params: {
          negocio_id: negocio,
          q: busquedaProducto || undefined,
          activo: true,
          limit: 100,
        },
      })

      setProductos(res.data.data || [])
    } catch (err) {
      console.error(err)
      setError(
        err.response?.data?.detail ||
        'No se pudieron cargar los productos'
      )
    }
  }

  function abrirNueva() {
    setForm(emptyForm)
    setItems([])
    setBusquedaCliente('')
    setBusquedaProducto('')
    setError('')
    setModal('nueva')
  }

  function cerrarModal() {
    if (guardando) return

    setModal(null)
    setForm(emptyForm)
    setItems([])
  }

  function seleccionarCliente(cliente) {
    const clienteId = cliente.id || cliente._id

    const clienteNombre =
      cliente.nombre ||
      cliente.empresa ||
      'Cliente'

    console.log('CLIENTE SELECCIONADO:', {
      cliente,
      clienteId,
      clienteNombre,
    })

    setForm(prev => ({
      ...prev,
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
    }))

    setBusquedaCliente('')
  }

  function agregarProducto(producto) {
    const productoId = producto.id || producto._id
    const precio = Number(producto.precio_base || 0)
    const costo = Number(producto.costo || 0)

    setItems(prev => {
      const existente = prev.find(
        item => item.producto_id === productoId
      )

      if (existente) {
        return prev.map(item =>
          item.producto_id === productoId
            ? {
                ...item,
                cantidad: item.cantidad + 1,
                importe:
                  (item.cantidad + 1) * item.precio_unitario,
              }
            : item
        )
      }

      return [
        ...prev,
        {
          producto_id: productoId,
          codigo: producto.codigo || '',
          sku: producto.sku || '',
          nombre: producto.nombre || '',
          unidad: producto.unidad || 'pieza',
          cantidad: 1,
          precio_unitario: precio,
          costo,
          importe: precio,
          iva_aplicable:
            producto.iva_aplicable !== false,
          iva_pct: Number(producto.iva_pct ?? 16),
        },
      ]
    })
  }

  function cambiarCantidad(index, cantidad) {
    const nuevaCantidad = Math.max(
      0.01,
      Number(cantidad) || 0
    )

    setItems(prev =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              cantidad: nuevaCantidad,
              importe:
                nuevaCantidad * item.precio_unitario,
            }
          : item
      )
    )
  }

  function cambiarPrecio(index, precio) {
    const nuevoPrecio = Math.max(
      0,
      Number(precio) || 0
    )

    setItems(prev =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              precio_unitario: nuevoPrecio,
              importe:
                item.cantidad * nuevoPrecio,
            }
          : item
      )
    )
  }

  function eliminarItem(index) {
    setItems(prev =>
      prev.filter((_, i) => i !== index)
    )
  }

  const subtotal = useMemo(() => {
    return items.reduce(
      (total, item) => total + Number(item.importe || 0),
      0
    )
  }, [items])

  const descuento = useMemo(() => {
    return (
      subtotal *
      (Number(form.descuento_pct || 0) / 100)
    )
  }, [subtotal, form.descuento_pct])

  const baseImpuesto = subtotal - descuento

  const iva = form.iva_aplicable
    ? baseImpuesto *
      (Number(form.iva_pct || 0) / 100)
    : 0

  const total = baseImpuesto + iva

  async function guardarCotizacion() {
    setError('')

    if (!form.cliente_id) {
      setError('Selecciona un cliente.')
      return
    }

    if (items.length === 0) {
      setError(
        'Agrega al menos un producto o servicio.'
      )
      return
    }

    setGuardando(true)

    try {
      const body = {
        negocio_id: negocio,

        cliente_id: form.cliente_id,
        cliente_nombre: form.cliente_nombre,

        fecha_emision:
          new Date().toISOString().slice(0, 10),

        vigencia_dias:
          Number(form.vigencia_dias || 15),

        estado: 'borrador',

        items,

        subtotal,
        descuento_pct:
          Number(form.descuento_pct || 0),
        descuento,

        iva_aplicable: form.iva_aplicable,
        iva_pct: Number(form.iva_pct || 0),
        iva,

        total,

        pagos: [],

        notas: form.notas,

        historial: [
          {
            fecha: new Date().toISOString(),
            accion: 'creada',
            estado: 'borrador',
          },
        ],
      }

      await cotizacionesApi.crear(body)

      cerrarModal()
      await cargarCotizaciones()
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No se pudo guardar la cotización'
      )
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarEstado(id, estado) {
    try {
      await cotizacionesApi.cambiarEstado(
        id,
        estado
      )

      await cargarCotizaciones()
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No se pudo cambiar el estado'
      )
    }
  }

  function dinero(valor) {
    return Number(valor || 0).toLocaleString(
      'es-MX',
      {
        style: 'currency',
        currency: 'MXN',
      }
    )
  }

  function fecha(valor) {
    if (!valor) return '-'

    return new Date(
      `${valor}T00:00:00`
    ).toLocaleDateString('es-MX')
  }

  const clientesFiltrados = clientes.filter(cliente => {
    const texto = busquedaCliente
      .toLowerCase()
      .trim()

    if (!texto) return true

    return [
      cliente.nombre,
      cliente.empresa,
      cliente.telefono,
      cliente.whatsapp,
      cliente.email,
    ]
      .filter(Boolean)
      .some(valor =>
        String(valor)
          .toLowerCase()
          .includes(texto)
      )
  })

  const productosFiltrados = productos.filter(producto => {
    const texto = busquedaProducto
      .toLowerCase()
      .trim()

    if (!texto) return true

    return [
      producto.nombre,
      producto.codigo,
      producto.sku,
      producto.descripcion,
    ]
      .filter(Boolean)
      .some(valor =>
        String(valor)
          .toLowerCase()
          .includes(texto)
      )
  })

  return (
    <div
      style={{
        padding: '24px',
        maxWidth: 1400,
        margin: '0 auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              color: '#1e293b',
              fontSize: 28,
            }}
          >
            Cotizaciones
          </h1>

          <p
            style={{
              marginTop: 6,
              color: '#64748b',
            }}
          >
            Administración de cotizaciones
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <select
            value={negocio}
            onChange={e => {
              setNegocio(e.target.value)
              localStorage.setItem(
                'negocio_id',
                e.target.value
              )
            }}
            style={styles.input}
          >
            {NEGOCIOS.map(n => (
              <option
                key={n.id}
                value={n.id}
              >
                {n.label}
              </option>
            ))}
          </select>

          <button
            onClick={abrirNueva}
            style={styles.primaryButton}
          >
            + Nueva cotización
          </button>
        </div>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      <div style={styles.card}>
        {loading ? (
          <p>Cargando cotizaciones...</p>
        ) : cotizaciones.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: '#64748b',
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              No hay cotizaciones
            </div>

            <div>
              Crea la primera cotización
              para este negocio.
            </div>
          </div>
        ) : (
          <div
            style={{
              overflowX: 'auto',
            }}
          >
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>
                    Cotización
                  </th>

                  <th style={styles.th}>
                    Cliente
                  </th>

                  <th style={styles.th}>
                    Fecha
                  </th>

                  <th style={styles.th}>
                    Vencimiento
                  </th>

                  <th style={styles.th}>
                    Total
                  </th>

                  <th style={styles.th}>
                    Estado
                  </th>
                </tr>
              </thead>

              <tbody>
                {cotizaciones.map(cot => (
                  <tr key={cot.id}>
                    <td style={styles.td}>
                      <strong>
                        {cot.numero ||
                          cot.folio ||
                          `#${cot.id?.slice(-6)}`}
                      </strong>
                    </td>

                    <td style={styles.td}>
                      {cot.cliente_nombre ||
                        cot.cliente_id ||
                        '-'}
                    </td>

                    <td style={styles.td}>
                      {fecha(
                        cot.fecha_emision
                      )}
                    </td>

                    <td style={styles.td}>
                      {fecha(
                        cot.fecha_vencimiento
                      )}
                    </td>

                    <td style={styles.td}>
                      {dinero(cot.total)}
                    </td>

                    <td style={styles.td}>
                      <select
                        value={
                          cot.estado ||
                          'borrador'
                        }
                        onChange={e =>
                          cambiarEstado(
                            cot.id,
                            e.target.value
                          )
                        }
                        style={{
                          ...styles.input,
                          padding: '6px 8px',
                        }}
                      >
                        {ESTADOS.map(
                          ([id, label]) => (
                            <option
                              key={id}
                              value={id}
                            >
                              {label}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal === 'nueva' && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div
              style={{
                display: 'flex',
                justifyContent:
                  'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    color: '#1e293b',
                  }}
                >
                  Nueva cotización
                </h2>

                <div
                  style={{
                    marginTop: 5,
                    color: '#64748b',
                    fontSize: 13,
                  }}
                >
                  {
                    NEGOCIOS.find(
                      n => n.id === negocio
                    )?.label
                  }
                </div>
              </div>

              <button
                onClick={cerrarModal}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                Cliente
              </h3>

              {form.cliente_id ? (
                <div
                  style={{
                    ...styles.selectedBox,
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <strong>
                      {form.cliente_nombre}
                    </strong>
                  </div>

                  <button
                    onClick={() =>
                      setForm(prev => ({
                        ...prev,
                        cliente_id: '',
                        cliente_nombre: '',
                      }))
                    }
                    style={styles.linkButton}
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={busquedaCliente}
                    onChange={e => {
                      setBusquedaCliente(
                        e.target.value
                      )
                    }}
                    placeholder="Buscar cliente..."
                    style={styles.input}
                  />

                  <div
                    style={{
                      marginTop: 8,
                      maxHeight: 180,
                      overflowY: 'auto',
                      border:
                        '1px solid #e2e8f0',
                      borderRadius: 8,
                    }}
                  >
                    {clientesFiltrados.length ===
                    0 ? (
                      <div
                        style={{
                          padding: 12,
                          color: '#64748b',
                        }}
                      >
                        No se encontraron
                        clientes.
                      </div>
                    ) : (
                      clientesFiltrados.map(
                        cliente => (
                          <button
                            type="button"
                            key={cliente.id || cliente._id}
                            onClick={() => seleccionarCliente(cliente)}
                            style={styles.optionButton}
                          >
                            <strong>
                              {cliente.nombre ||
                                cliente.empresa ||
                                'Sin nombre'}
                            </strong>

                            {cliente.empresa && (
                              <span
                                style={{
                                  color:
                                    '#64748b',
                                  fontSize: 12,
                                }}
                              >
                                {cliente.empresa}
                              </span>
                            )}
                          </button>
                        )
                      )
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                Vigencia y condiciones
              </h3>

              <div style={styles.grid3}>
                <label style={styles.label}>
                  Vigencia (días)

                  <input
                    type="number"
                    min="1"
                    value={form.vigencia_dias}
                    onChange={e =>
                      setForm(prev => ({
                        ...prev,
                        vigencia_dias:
                          e.target.value,
                      }))
                    }
                    style={styles.input}
                  />
                </label>

                <label style={styles.label}>
                  Descuento %

                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.descuento_pct}
                    onChange={e =>
                      setForm(prev => ({
                        ...prev,
                        descuento_pct:
                          e.target.value,
                      }))
                    }
                    style={styles.input}
                  />
                </label>

                <label style={styles.label}>
                  IVA %

                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.iva_pct}
                    disabled={
                      !form.iva_aplicable
                    }
                    onChange={e =>
                      setForm(prev => ({
                        ...prev,
                        iva_pct:
                          e.target.value,
                      }))
                    }
                    style={styles.input}
                  />
                </label>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    form.iva_aplicable
                  }
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      iva_aplicable:
                        e.target.checked,
                    }))
                  }
                />

                Aplicar IVA
              </label>
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>
                Productos / servicios
              </h3>

              <input
                value={busquedaProducto}
                onChange={e =>
                  setBusquedaProducto(
                    e.target.value
                  )
                }
                placeholder="Buscar producto, código o SKU..."
                style={styles.input}
              />

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 8,
                  marginTop: 10,
                  maxHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {productosFiltrados.map(
                  producto => (
                    <button
                      key={producto.id}
                      onClick={() =>
                        agregarProducto(
                          producto
                        )
                      }
                      style={
                        styles.productButton
                      }
                    >
                      <strong>
                        {producto.nombre}
                      </strong>

                      <span
                        style={{
                          color: '#64748b',
                          fontSize: 12,
                        }}
                      >
                        {producto.codigo ||
                          producto.sku ||
                          ''}
                      </span>

                      <span
                        style={{
                          marginTop: 4,
                          fontWeight: 600,
                        }}
                      >
                        {dinero(
                          producto.precio_base
                        )}
                      </span>
                    </button>
                  )
                )}
              </div>

              {items.length > 0 && (
                <div
                  style={{
                    marginTop: 18,
                    overflowX: 'auto',
                  }}
                >
                  <table
                    style={styles.table}
                  >
                    <thead>
                      <tr>
                        <th
                          style={styles.th}
                        >
                          Producto
                        </th>

                        <th
                          style={styles.th}
                        >
                          Cant.
                        </th>

                        <th
                          style={styles.th}
                        >
                          Precio
                        </th>

                        <th
                          style={styles.th}
                        >
                          Importe
                        </th>

                        <th
                          style={styles.th}
                        />
                      </tr>
                    </thead>

                    <tbody>
                      {items.map(
                        (item, index) => (
                          <tr
                            key={`${item.producto_id}-${index}`}
                          >
                            <td
                              style={styles.td}
                            >
                              <strong>
                                {item.nombre}
                              </strong>

                              {item.codigo && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color:
                                      '#64748b',
                                  }}
                                >
                                  {item.codigo}
                                </div>
                              )}
                            </td>

                            <td
                              style={styles.td}
                            >
                              <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={
                                  item.cantidad
                                }
                                onChange={e =>
                                  cambiarCantidad(
                                    index,
                                    e.target
                                      .value
                                  )
                                }
                                style={{
                                  ...styles.input,
                                  width: 85,
                                }}
                              />
                            </td>

                            <td
                              style={styles.td}
                            >
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  item.precio_unitario
                                }
                                onChange={e =>
                                  cambiarPrecio(
                                    index,
                                    e.target
                                      .value
                                  )
                                }
                                style={{
                                  ...styles.input,
                                  width: 110,
                                }}
                              />
                            </td>

                            <td
                              style={{
                                ...styles.td,
                                fontWeight: 600,
                              }}
                            >
                              {dinero(
                                item.importe
                              )}
                            </td>

                            <td
                              style={
                                styles.td
                              }
                            >
                              <button
                                onClick={() =>
                                  eliminarItem(
                                    index
                                  )
                                }
                                style={
                                  styles.deleteButton
                                }
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={styles.summary}>
              <div>
                Subtotal
                <strong>
                  {dinero(subtotal)}
                </strong>
              </div>

              <div>
                Descuento
                <strong>
                  -{dinero(descuento)}
                </strong>
              </div>

              <div>
                IVA
                <strong>
                  {dinero(iva)}
                </strong>
              </div>

              <div
                style={{
                  fontSize: 18,
                  paddingTop: 10,
                  marginTop: 8,
                  borderTop:
                    '1px solid #cbd5e1',
                }}
              >
                Total
                <strong>
                  {dinero(total)}
                </strong>
              </div>
            </div>

            <div style={styles.section}>
              <label style={styles.label}>
                Notas

                <textarea
                  value={form.notas}
                  onChange={e =>
                    setForm(prev => ({
                      ...prev,
                      notas: e.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Condiciones, observaciones o notas..."
                  style={{
                    ...styles.input,
                    resize: 'vertical',
                  }}
                />
              </label>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 20,
              }}
            >
              <button
                onClick={cerrarModal}
                disabled={guardando}
                style={styles.secondaryButton}
              >
                Cancelar
              </button>

              <button
                onClick={guardarCotizacion}
                disabled={guardando}
                style={styles.primaryButton}
              >
                {guardando
                  ? 'Guardando...'
                  : 'Guardar cotización'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 20,
    boxShadow:
      '0 1px 3px rgba(15,23,42,.05)',
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#fff',
    color: '#1e293b',
    fontSize: 14,
  },

  primaryButton: {
    border: 0,
    borderRadius: 8,
    padding: '10px 16px',
    background: '#2563eb',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
  },

  secondaryButton: {
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '10px 16px',
    background: '#fff',
    color: '#334155',
    fontWeight: 600,
    cursor: 'pointer',
  },

  closeButton: {
    border: 0,
    background: 'transparent',
    fontSize: 30,
    color: '#64748b',
    cursor: 'pointer',
    lineHeight: 1,
  },

  deleteButton: {
    border: 0,
    background: '#fee2e2',
    color: '#b91c1c',
    width: 30,
    height: 30,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 18,
  },

  linkButton: {
    border: 0,
    background: 'transparent',
    color: '#2563eb',
    cursor: 'pointer',
    fontWeight: 600,
  },

  optionButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
    border: 0,
    borderBottom:
      '1px solid #f1f5f9',
    background: '#fff',
    padding: '10px 12px',
    cursor: 'pointer',
  },

  productButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    border:
      '1px solid #e2e8f0',
    borderRadius: 8,
    background: '#fff',
    padding: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },

  selectedBox: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
  },

  error: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#b91c1c',
  },

  section: {
    marginTop: 20,
    paddingTop: 18,
    borderTop: '1px solid #e2e8f0',
  },

  sectionTitle: {
    margin: '0 0 12px',
    fontSize: 16,
    color: '#334155',
  },

  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    color: '#475569',
    fontSize: 13,
    fontWeight: 600,
  },

  grid3: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(3, minmax(0, 1fr))',
    gap: 12,
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },

  th: {
    textAlign: 'left',
    padding: '11px 10px',
    borderBottom:
      '2px solid #e2e8f0',
    color: '#475569',
    fontSize: 13,
  },

  td: {
    padding: '11px 10px',
    borderBottom:
      '1px solid #f1f5f9',
    color: '#334155',
    fontSize: 14,
  },

  summary: {
    marginTop: 20,
    marginLeft: 'auto',
    maxWidth: 320,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    color: '#475569',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background:
      'rgba(15, 23, 42, .55)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },

  modal: {
    width: 'min(1100px, 100%)',
    maxHeight: '92vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: 14,
    padding: 24,
    boxShadow:
      '0 20px 50px rgba(15,23,42,.25)',
  },
}
