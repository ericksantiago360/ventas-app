import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'
import useEsMovil from '../hooks/useEsMovil'

const api = axios.create({
  baseURL: '',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

const ESTADOS = [
  'confirmado',
  'en_proceso',
  'listo',
  'entregado',
  'cobrado',
  'cancelado',
]

const ESTADOS_KANBAN = [
  'confirmado',
  'en_proceso',
  'listo',
  'entregado',
]

const ETAPAS = [
  'recibido',
  'en_corte',
  'en_acabado',
  'control_calidad',
  'listo_para_recoger',
]

const estadoLabel = {
  confirmado: 'Confirmado',
  en_proceso: 'En proceso',
  listo: 'Listo',
  entregado: 'Entregado',
  cobrado: 'Cobrado',
  cancelado: 'Cancelado',
}

const etapaLabel = {
  recibido: 'Recibido',
  en_corte: 'En corte',
  en_acabado: 'En acabado',
  control_calidad: 'Control de calidad',
  listo_para_recoger: 'Listo para recoger',
  preparando: 'Preparando',
  en_ruta: 'En ruta',
  listo_para_entrega: 'Listo para entrega',
  docs_pendientes: 'Documentos pendientes',
  revisando_docs: 'Revisando documentos',
  aprobado: 'Aprobado',
  contrato_listo: 'Contrato listo',
  registro: 'Registro',
  procesamiento: 'Procesamiento',
  validacion: 'Validación',
}

const nombreEtapa = (etapa) =>
  etapaLabel[etapa] ||
  etapa.charAt(0).toUpperCase() + etapa.slice(1).replace(/_/g, ' ')

const estadoColor = {
  confirmado: '#2563eb',
  en_proceso: '#d97706',
  listo: '#16a34a',
  entregado: '#7c3aed',
  cobrado: '#059669',
  cancelado: '#dc2626',
}

const emptyForm = {
  cliente_id: '',
  cliente_nombre: '',
  fecha_entrega: '',
  notas: '',
  descuento: 0,
  items: [],
}

function money(value) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(Number(value || 0))
}

function fecha(value) {
  if (!value) return '-'

  try {
    return new Date(value).toLocaleDateString('es-MX')
  } catch {
    return value
  }
}

function normalizarPedido(pedido) {
  return {
    ...pedido,
    items: Array.isArray(pedido.items) ? pedido.items : [],
    pagos: Array.isArray(pedido.pagos) ? pedido.pagos : [],
    historial: Array.isArray(pedido.historial) ? pedido.historial : [],
    descuento: Number(pedido.descuento || 0),
    subtotal: Number(pedido.subtotal || 0),
    iva: Number(pedido.iva || 0),
    total: Number(pedido.total || 0),
    saldo_pendiente: Number(pedido.saldo_pendiente || 0),
  }
}

export default function Pedidos() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()
  const esMovil = useEsMovil()

  const [pedidos, setPedidos] = useState([])
  const [totalRegistros, setTotalRegistros] = useState(0)

  const [clientes, setClientes] = useState([])
  const [productos, setProductos] = useState([])
  const [etapas, setEtapas] = useState(ETAPAS)

  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')

  const [vista, setVista] = useState('lista')

  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const [modal, setModal] = useState(null)

  const [pedidoSeleccionado, setPedidoSeleccionado] =
    useState(null)

  const [form, setForm] = useState(emptyForm)

  const [pagoForm, setPagoForm] = useState({
    monto: '',
    metodo: 'efectivo',
    referencia: '',
    nota: '',
  })

  const cargarPedidos = async () => {
    try {
      setCargando(true)
      setError('')

      const response = await api.get('/api/pedidos/', {
        params: {
          negocio_id: negocioId,
          estado: estadoFiltro || undefined,
          page: 1,
          limit: 100,
        },
      })

      const data = response.data || {}

      const lista = Array.isArray(data.data)
        ? data.data
        : []

      setPedidos(lista.map(normalizarPedido))
      setTotalRegistros(Number(data.total || lista.length))
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible cargar los pedidos.'
      )
    } finally {
      setCargando(false)
    }
  }

  const cargarClientes = async () => {
    try {
      const response = await api.get('/api/crm/clientes', {
        params: {
          negocio_id: negocioId,
        },
      })

      const data = response.data

      setClientes(
        Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : []
      )
    } catch (err) {
      console.error('Error cargando clientes:', err)
    }
  }

  const cargarProductos = async () => {
    try {
      const response = await api.get(
        '/api/catalogo/productos',
        {
          params: {
            negocio_id: negocioId,
          },
        }
      )

      const data = response.data

      setProductos(
        Array.isArray(data)
          ? data
          : Array.isArray(data?.data)
            ? data.data
            : []
      )
    } catch (err) {
      console.error('Error cargando productos:', err)
    }
  }

  useEffect(() => {
    cargarPedidos()
  }, [negocioId, estadoFiltro])

  const cargarEtapas = async () => {
    try {
      const response = await api.get('/api/pedidos/etapas', {
        params: {
          negocio_id: negocioId,
        },
      })

      const lista = response.data?.data

      setEtapas(
        Array.isArray(lista) && lista.length
          ? lista
          : ETAPAS
      )
    } catch (err) {
      console.error('Error cargando etapas:', err)
      setEtapas(ETAPAS)
    }
  }

  useEffect(() => {
    cargarClientes()
    cargarProductos()
    cargarEtapas()
  }, [negocioId])

  const pedidosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase()

    if (!texto) return pedidos

    return pedidos.filter((pedido) => {
      const contenido = [
        pedido.numero,
        pedido.cliente_nombre,
        pedido.cliente,
        pedido.estado,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return contenido.includes(texto)
    })
  }, [pedidos, busqueda])

  const abrirNuevo = () => {
    setPedidoSeleccionado(null)

    setForm({
      ...emptyForm,
      items: [],
    })

    setModal('form')
  }

  const abrirEditar = async (pedido) => {
    try {
      const response = await api.get(
        `/api/pedidos/${pedido._id || pedido.id}`
      )

      const completo = normalizarPedido(response.data)

      setPedidoSeleccionado(completo)

      setForm({
        cliente_id: completo.cliente_id || '',
        cliente_nombre:
          completo.cliente_nombre ||
          completo.cliente ||
          '',
        fecha_entrega:
          completo.fecha_entrega || '',
        notas: completo.notas || '',
        descuento: completo.descuento || 0,
        items: completo.items || [],
      })

      setModal('form')
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible abrir el pedido.'
      )
    }
  }

  const abrirDetalle = async (pedido) => {
    try {
      const id = pedido._id || pedido.id

      const response = await api.get(
        `/api/pedidos/${id}`
      )

      setPedidoSeleccionado(
        normalizarPedido(response.data)
      )

      setModal('detalle')
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible cargar el pedido.'
      )
    }
  }

  const agregarProducto = (producto) => {
    const nuevoItem = {
      producto_id: String(
        producto._id || producto.id || ''
      ),
      codigo: producto.codigo || '',
      sku: producto.sku || '',
      nombre: producto.nombre || 'Producto',
      cantidad: 1,
      precio_unitario: Number(
        producto.precio_base || producto.precio || 0
      ),
      descuento: 0,
      iva_aplicable:
        producto.iva_aplicable !== false,
      iva_pct: Number(producto.iva_pct || 16),
    }

    setForm((actual) => ({
      ...actual,
      items: [
        ...actual.items,
        nuevoItem,
      ],
    }))
  }

  const actualizarItem = (index, campo, valor) => {
    setForm((actual) => ({
      ...actual,
      items: actual.items.map((item, i) =>
        i === index
          ? {
              ...item,
              [campo]:
                campo === 'cantidad' ||
                campo === 'precio_unitario' ||
                campo === 'descuento' ||
                campo === 'iva_pct'
                  ? Number(valor || 0)
                  : valor,
            }
          : item
      ),
    }))
  }

  const eliminarItem = (index) => {
    setForm((actual) => ({
      ...actual,
      items: actual.items.filter(
        (_, i) => i !== index
      ),
    }))
  }

  const totalesForm = useMemo(() => {
    let subtotal = 0
    let iva = 0

    form.items.forEach((item) => {
      const cantidad = Number(item.cantidad || 0)
      const precio = Number(
        item.precio_unitario || 0
      )
      const descuento = Number(
        item.descuento || 0
      )

      const importe =
        cantidad * precio - descuento

      subtotal += Math.max(0, importe)

      if (item.iva_aplicable !== false) {
        iva +=
          Math.max(0, importe) *
          (Number(item.iva_pct || 16) / 100)
      }
    })

    const descuentoGeneral =
      Number(form.descuento || 0)

    const subtotalFinal = Math.max(
      0,
      subtotal - descuentoGeneral
    )

    const total = subtotalFinal + iva

    return {
      subtotal,
      descuento: descuentoGeneral,
      iva,
      total,
    }
  }, [form.items, form.descuento])

  const guardarPedido = async (event) => {
    event.preventDefault()

    try {
      setCargando(true)
      setError('')

      if (!form.cliente_nombre.trim()) {
        setError('Selecciona o escribe un cliente.')
        return
      }

      if (form.items.length === 0) {
        setError(
          'Agrega al menos un producto o servicio.'
        )
        return
      }

      const body = {
        negocio_id: negocioId,

        cliente_id:
          form.cliente_id || null,

        cliente_nombre:
          form.cliente_nombre.trim(),

        fecha_entrega:
          form.fecha_entrega || null,

        notas:
          form.notas.trim(),

        descuento:
          Number(form.descuento || 0),

        items: form.items,

        subtotal:
          totalesForm.subtotal,

        iva:
          totalesForm.iva,

        total:
          totalesForm.total,
      }

      if (pedidoSeleccionado) {
        const id =
          pedidoSeleccionado._id ||
          pedidoSeleccionado.id

        await api.put(
          `/api/pedidos/${id}`,
          body
        )
      } else {
        await api.post(
          '/api/pedidos/',
          body
        )
      }

      setModal(null)
      setPedidoSeleccionado(null)

      await cargarPedidos()
    } catch (err) {
      console.error(err)

      setError(
        err.response?.data?.detail ||
        'No fue posible guardar el pedido.'
      )
    } finally {
      setCargando(false)
    }
  }

  const cancelarPedido = async (pedido) => {
    const id = pedido._id || pedido.id

    const confirmar = window.confirm(
      `¿Cancelar el pedido ${
        pedido.numero || id
      }?`
    )

    if (!confirmar) return

    try {
      setCargando(true)

      await api.delete(
        `/api/pedidos/${id}`
      )

      await cargarPedidos()
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible cancelar el pedido.'
      )
    } finally {
      setCargando(false)
    }
  }

  const eliminarPedido = async (pedido) => {
    const id = pedido._id || pedido.id
  
    const confirmar = window.confirm(
      `¿Eliminar de la lista el pedido ${
        pedido.numero || id
      }? Esta acción no se puede deshacer desde la interfaz.`
    )
  
    if (!confirmar) return
  
    try {
      setCargando(true)
  
      await api.patch(
        `/api/pedidos/${id}/eliminar`
      )
  
      await cargarPedidos()
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible eliminar el pedido.'
      )
    } finally {
      setCargando(false)
    }
  }
  
  const cambiarEstado = async (
    pedido,
    estado
  ) => {
    const id = pedido._id || pedido.id

    try {
      setCargando(true)

      await api.patch(
        `/api/pedidos/${id}/estado`,
        {
          estado,
        }
      )

      await cargarPedidos()

      if (pedidoSeleccionado) {
        const response = await api.get(
          `/api/pedidos/${id}`
        )

        setPedidoSeleccionado(
          normalizarPedido(response.data)
        )
      }
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible cambiar el estado.'
      )
    } finally {
      setCargando(false)
    }
  }

  const cambiarEtapa = async (
    pedido,
    etapa
  ) => {
    const id = pedido._id || pedido.id

    try {
      await api.patch(
        `/api/pedidos/${id}/etapa`,
        {
          etapa_interna: etapa,
        }
      )

      const response = await api.get(
        `/api/pedidos/${id}`
      )

      setPedidoSeleccionado(
        normalizarPedido(response.data)
      )

      await cargarPedidos()
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible cambiar la etapa.'
      )
    }
  }

  const registrarPago = async (event) => {
    event.preventDefault()

    if (!pedidoSeleccionado) return

    const id =
      pedidoSeleccionado._id ||
      pedidoSeleccionado.id

    if (
      !pagoForm.monto ||
      Number(pagoForm.monto) <= 0
    ) {
      setError('Captura un monto válido.')
      return
    }

    try {
      setCargando(true)

      await api.post(
        `/api/pedidos/${id}/pagos`,
        {
          monto: Number(
            pagoForm.monto
          ),
          metodo:
            pagoForm.metodo,
          referencia:
            pagoForm.referencia,
          nota:
            pagoForm.nota,
        }
      )

      const response = await api.get(
        `/api/pedidos/${id}`
      )

      setPedidoSeleccionado(
        normalizarPedido(response.data)
      )

      setPagoForm({
        monto: '',
        metodo: 'efectivo',
        referencia: '',
        nota: '',
      })

      await cargarPedidos()
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'No fue posible registrar el pago.'
      )
    } finally {
      setCargando(false)
    }
  }

  return (
    <div>

      {/* HEADER */}
      <div style={esMovil ? { ...styles.header, flexDirection: 'column', alignItems: 'stretch', gap: 12, marginBottom: 16 } : styles.header}>
        <div>
          <h1 style={esMovil ? { ...styles.title, fontSize: 22 } : styles.title}>
            Pedidos
          </h1>

          <p style={styles.subtitle}>
            Gestión y seguimiento de pedidos
          </p>
        </div>

        <div style={esMovil ? { ...styles.headerActions, flexWrap: 'wrap' } : styles.headerActions}>
          <select
            aria-label="Seleccionar empresa"
            value={negocioId}
            onChange={(e) => {
              setPedidos([])
              setTotalRegistros(0)
              setClientes([])
              setProductos([])
              setPedidoSeleccionado(null)
              setModal(null)
              setError('')
              setNegocioId(e.target.value)
            }}
            style={esMovil ? { ...styles.select, flex: '1 1 100%' } : styles.select}
          >
            {negociosDisponibles.map((neg) => (
              <option key={neg.id} value={neg.id}>{neg.nombre}</option>
            ))}
          </select>

          <button
            onClick={() =>
              setVista(
                vista === 'lista'
                  ? 'kanban'
                  : 'lista'
              )
            }
            style={esMovil ? { ...styles.secondaryButton, flex: 1, padding: '10px 14px' } : styles.secondaryButton}
          >
            {vista === 'lista'
              ? 'Vista Kanban'
              : 'Vista lista'}
          </button>

          <button
            onClick={abrirNuevo}
            style={esMovil ? { ...styles.primaryButton, flex: 1, padding: '10px 14px' } : styles.primaryButton}
          >
            + Nuevo pedido
          </button>
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div style={styles.error}>
          <span>{error}</span>

          <button
            onClick={() => setError('')}
            style={styles.closeError}
          >
            ×
          </button>
        </div>
      )}

      {/* FILTROS */}
      <div style={esMovil ? { ...styles.filters, flexWrap: 'wrap' } : styles.filters}>

        <input
          value={busqueda}
          onChange={(e) =>
            setBusqueda(e.target.value)
          }
          placeholder="Buscar pedido o cliente..."
          style={esMovil ? { ...styles.input, flex: '1 1 100%' } : styles.input}
        />

        <select
          value={estadoFiltro}
          onChange={(e) =>
            setEstadoFiltro(e.target.value)
          }
          style={esMovil ? { ...styles.select, flex: 1 } : styles.select}
        >
          <option value="">
            Todos los estados
          </option>

          {ESTADOS.map((estado) => (
            <option
              key={estado}
              value={estado}
            >
              {estadoLabel[estado]}
            </option>
          ))}
        </select>

        <button
          onClick={cargarPedidos}
          style={styles.secondaryButton}
        >
          Actualizar
        </button>

        <div style={styles.counter}>
          {totalRegistros} pedido
          {totalRegistros === 1 ? '' : 's'}
        </div>
      </div>

      {vista === 'lista' ? (
        <ListaPedidos
          pedidos={pedidosFiltrados}
          cargando={cargando}
          abrirDetalle={abrirDetalle}
          abrirEditar={abrirEditar}
          cancelarPedido={cancelarPedido}
          eliminarPedido={eliminarPedido}
          esMovil={esMovil}
        />
      ) : (
        <Kanban
          pedidos={pedidos}
          cargando={cargando}
          abrirDetalle={abrirDetalle}
          cambiarEstado={cambiarEstado}
          esMovil={esMovil}
        />
      )}

      {/* MODAL FORMULARIO */}
      {modal === 'form' && (
        <Modal
          titulo={
            pedidoSeleccionado
              ? `Editar ${
                  pedidoSeleccionado.numero ||
                  'pedido'
                }`
              : 'Nuevo pedido'
          }
          cerrar={() => {
            setModal(null)
            setPedidoSeleccionado(null)
          }}
          ancho={1000}
        >
          <form onSubmit={guardarPedido}>

            <div style={styles.formGrid}>

              <div>
                <label style={styles.label}>
                  Cliente
                </label>

                <select
                  value={form.cliente_id}
                  onChange={(e) => {
                    const cliente =
                      clientes.find(
                        (item) =>
                          String(
                            item._id ||
                            item.id
                          ) ===
                          e.target.value
                      )

                    setForm((actual) => ({
                      ...actual,
                      cliente_id:
                        e.target.value,
                      cliente_nombre:
                        cliente
                          ? (
                              cliente.nombre ||
                              cliente.razon_social ||
                              cliente.nombre_comercial ||
                              ''
                            )
                          : '',
                    }))
                  }}
                  style={styles.input}
                >
                  <option value="">
                    Seleccionar cliente
                  </option>

                  {clientes.map((cliente) => {
                    const id =
                      cliente._id ||
                      cliente.id

                    const nombre =
                      cliente.nombre ||
                      cliente.razon_social ||
                      cliente.nombre_comercial ||
                      id

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {nombre}
                      </option>
                    )
                  })}
                </select>
              </div>

              <div>
                <label style={styles.label}>
                  Nombre del cliente
                </label>

                <input
                  value={form.cliente_nombre}
                  onChange={(e) =>
                    setForm((actual) => ({
                      ...actual,
                      cliente_nombre:
                        e.target.value,
                    }))
                  }
                  placeholder="Cliente"
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>
                  Fecha de entrega
                </label>

                <input
                  type="date"
                  value={form.fecha_entrega}
                  onChange={(e) =>
                    setForm((actual) => ({
                      ...actual,
                      fecha_entrega:
                        e.target.value,
                    }))
                  }
                  style={styles.input}
                />
              </div>

              <div>
                <label style={styles.label}>
                  Descuento general
                </label>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.descuento}
                  onChange={(e) =>
                    setForm((actual) => ({
                      ...actual,
                      descuento:
                        Number(
                          e.target.value || 0
                        ),
                    }))
                  }
                  style={styles.input}
                />
              </div>

            </div>

            {/* PRODUCTOS */}
            <div style={styles.section}>
              <div style={styles.sectionHeader}>
                <h3 style={styles.sectionTitle}>
                  Productos / servicios
                </h3>
              </div>

              <div style={styles.productPicker}>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const producto =
                      productos.find(
                        (item) =>
                          String(
                            item._id ||
                            item.id
                          ) ===
                          e.target.value
                      )

                    if (producto) {
                      agregarProducto(
                        producto
                      )

                      e.target.value = ''
                    }
                  }}
                  style={styles.input}
                >
                  <option value="">
                    + Agregar producto del catálogo
                  </option>

                  {productos
                    .filter(
                      (producto) =>
                        producto.activo !== false
                    )
                    .map((producto) => {
                      const id =
                        producto._id ||
                        producto.id

                      return (
                        <option
                          key={id}
                          value={id}
                        >
                          {producto.nombre}
                          {' — '}
                          {money(
                            producto.precio_base
                          )}
                        </option>
                      )
                    })}
                </select>
              </div>

              {form.items.length === 0 ? (
                <div style={styles.emptyItems}>
                  No hay productos agregados.
                </div>
              ) : (
                <div style={styles.itemsTable}>

                  <div style={styles.itemHeader}>
                    <span>Producto</span>
                    <span>Cantidad</span>
                    <span>Precio</span>
                    <span>Importe</span>
                    <span></span>
                  </div>

                  {form.items.map(
                    (item, index) => {
                      const importe =
                        Number(
                          item.cantidad || 0
                        ) *
                          Number(
                            item.precio_unitario ||
                              0
                          ) -
                        Number(
                          item.descuento || 0
                        )

                      return (
                        <div
                          key={index}
                          style={styles.itemRow}
                        >
                          <div>
                            <strong>
                              {item.nombre}
                            </strong>

                            {item.codigo && (
                              <div style={styles.muted}>
                                {item.codigo}
                              </div>
                            )}
                          </div>

                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={
                              item.cantidad
                            }
                            onChange={(e) =>
                              actualizarItem(
                                index,
                                'cantidad',
                                e.target.value
                              )
                            }
                            style={
                              styles.smallInput
                            }
                          />

                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={
                              item.precio_unitario
                            }
                            onChange={(e) =>
                              actualizarItem(
                                index,
                                'precio_unitario',
                                e.target.value
                              )
                            }
                            style={
                              styles.smallInput
                            }
                          />

                          <strong>
                            {money(importe)}
                          </strong>

                          <button
                            type="button"
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
                        </div>
                      )
                    }
                  )}

                </div>
              )}
            </div>

            {/* NOTAS */}
            <div style={styles.section}>
              <label style={styles.label}>
                Notas
              </label>

              <textarea
                value={form.notas}
                onChange={(e) =>
                  setForm((actual) => ({
                    ...actual,
                    notas: e.target.value,
                  }))
                }
                rows={3}
                placeholder="Notas del pedido..."
                style={{
                  ...styles.input,
                  resize: 'vertical',
                }}
              />
            </div>

            {/* TOTALES */}
            <div style={styles.totalsBox}>

              <div>
                <span>Subtotal</span>
                <strong>
                  {money(
                    totalesForm.subtotal
                  )}
                </strong>
              </div>

              <div>
                <span>Descuento</span>
                <strong>
                  {money(
                    totalesForm.descuento
                  )}
                </strong>
              </div>

              <div>
                <span>IVA</span>
                <strong>
                  {money(
                    totalesForm.iva
                  )}
                </strong>
              </div>

              <div style={styles.totalRow}>
                <span>Total</span>
                <strong>
                  {money(
                    totalesForm.total
                  )}
                </strong>
              </div>

            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => {
                  setModal(null)
                  setPedidoSeleccionado(null)
                }}
                style={styles.secondaryButton}
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={cargando}
                style={styles.primaryButton}
              >
                {cargando
                  ? 'Guardando...'
                  : pedidoSeleccionado
                    ? 'Guardar cambios'
                    : 'Crear pedido'}
              </button>
            </div>

          </form>
        </Modal>
      )}

      {/* DETALLE */}
      {modal === 'detalle' &&
        pedidoSeleccionado && (
          <Modal
            titulo={
              pedidoSeleccionado.numero ||
              'Detalle del pedido'
            }
            cerrar={() =>
              setModal(null)
            }
            ancho={1000}
          >
            <DetallePedido
              pedido={
                pedidoSeleccionado
              }
              cambiarEstado={
                cambiarEstado
              }
              cambiarEtapa={
                cambiarEtapa
              }
              etapas={etapas}
              registrarPago={
                registrarPago
              }
              pagoForm={
                pagoForm
              }
              setPagoForm={
                setPagoForm
              }
              abrirEditar={
                abrirEditar
              }
            />
          </Modal>
        )}

    </div>
  )
}

/* =====================================================
   LISTA
===================================================== */

function ListaPedidos({
  pedidos,
  cargando,
  abrirDetalle,
  abrirEditar,
  cancelarPedido,
  eliminarPedido,
  esMovil,
}) {
  if (cargando && pedidos.length === 0) {
    return (
      <div style={styles.loading}>
        Cargando pedidos...
      </div>
    )
  }

  if (pedidos.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyTitle}>
          No hay pedidos
        </div>

        <div>
          Crea el primer pedido para comenzar.
        </div>
      </div>
    )
  }

  if (esMovil) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pedidos.map((pedido) => (
          <PedidoTarjeta
            key={pedido._id || pedido.id}
            pedido={pedido}
            abrirDetalle={abrirDetalle}
            abrirEditar={abrirEditar}
            cancelarPedido={cancelarPedido}
            eliminarPedido={eliminarPedido}
          />
        ))}
      </div>
    )
  }

  return (
    <div style={styles.card}>

      <div style={styles.tableHeader}>
        <span>Pedido</span>
        <span>Cliente</span>
        <span>Fecha</span>
        <span>Total</span>
        <span>Saldo</span>
        <span>Estado</span>
        <span>Acciones</span>
      </div>

      {pedidos.map((pedido) => (
        <div
          key={
            pedido._id ||
            pedido.id
          }
          style={styles.tableRow}
        >

          <button
            onClick={() =>
              abrirDetalle(pedido)
            }
            style={styles.linkButton}
          >
            {pedido.numero ||
              pedido._id ||
              pedido.id}
          </button>

          <div>
            {pedido.cliente_nombre ||
              pedido.cliente ||
              '-'}
          </div>

          <div>
            {fecha(
              pedido.created_at ||
              pedido.fecha
            )}
          </div>

          <strong>
            {money(pedido.total)}
          </strong>

          <strong
            style={{
              color:
                Number(
                  pedido.saldo_pendiente ||
                    0
                ) > 0
                  ? '#dc2626'
                  : '#16a34a',
            }}
          >
            {money(
              pedido.saldo_pendiente
            )}
          </strong>

          <EstadoBadge
            estado={
              pedido.estado ||
              'confirmado'
            }
          />

          <div style={styles.actions}>

            <button
              onClick={() =>
                abrirDetalle(pedido)
              }
              style={styles.actionButton}
            >
              Ver
            </button>

            <button
              onClick={() =>
                abrirEditar(pedido)
              }
              style={styles.actionButton}
            >
              Editar
            </button>

            {![
              'cancelado',
              'cobrado',
            ].includes(
              pedido.estado
            ) && (
              <button
                onClick={() =>
                  cancelarPedido(
                    pedido
                  )
                }
                style={
                  styles.cancelButton
                }
              >
                Cancelar
              </button>
            )}
            {![
              'entregado',
              'cobrado',
            ].includes(pedido.estado) && (
              <button
                onClick={() => eliminarPedido(pedido)}
                style={styles.cancelButton}
              >
                Eliminar
              </button>
            )}


          </div>

        </div>
      ))}

    </div>
  )
}

// Pedido en formato tarjeta para celular: tocarla abre el detalle
function PedidoTarjeta({
  pedido,
  abrirDetalle,
  abrirEditar,
  cancelarPedido,
  eliminarPedido,
}) {
  const saldo = Number(pedido.saldo_pendiente || 0)
  const estado = pedido.estado || 'confirmado'
  const boton = (base) => ({ ...base, flex: 1, padding: '10px 8px', fontSize: 14, borderRadius: 6 })

  return (
    <div
      onClick={() => abrirDetalle(pedido)}
      style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pedido.cliente_nombre || pedido.cliente || 'Sin cliente'}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            <span style={{ fontFamily: 'monospace' }}>{pedido.numero || pedido._id || pedido.id}</span>
            {' · '}{fecha(pedido.created_at || pedido.fecha)}
          </div>
        </div>
        <EstadoBadge estado={estado} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: saldo > 0 ? '#dc2626' : '#16a34a' }}>
          {saldo > 0 ? `Debe ${money(saldo)}` : 'Pagado'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{money(pedido.total)}</div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}
      >
        <button onClick={() => abrirEditar(pedido)} style={boton(styles.actionButton)}>
          Editar
        </button>
        {!['cancelado', 'cobrado'].includes(pedido.estado) && (
          <button onClick={() => cancelarPedido(pedido)} style={boton(styles.cancelButton)}>
            Cancelar
          </button>
        )}
        {!['entregado', 'cobrado'].includes(pedido.estado) && (
          <button onClick={() => eliminarPedido(pedido)} style={boton(styles.cancelButton)}>
            Eliminar
          </button>
        )}
      </div>
    </div>
  )
}

/* =====================================================
   KANBAN
===================================================== */

function Kanban({
  pedidos,
  cargando,
  abrirDetalle,
  cambiarEstado,
  esMovil,
}) {
  return (
    <div style={esMovil ? {
      ...styles.kanban,
      // En celular, las columnas se recorren deslizando de lado y se acomodan una por una
      gridTemplateColumns: 'repeat(4, 82%)',
      overflowX: 'auto',
      scrollSnapType: 'x mandatory',
      paddingBottom: 8,
    } : styles.kanban}>

      {ESTADOS_KANBAN.map(
        (estado) => {
          const columna =
            pedidos.filter(
              (pedido) =>
                pedido.estado ===
                estado
            )

          return (
            <div
              key={estado}
              style={
                esMovil
                  ? { ...styles.kanbanColumn, scrollSnapAlign: 'start' }
                  : styles.kanbanColumn
              }
            >

              <div
                style={
                  styles.kanbanHeader
                }
              >
                <span>
                  {
                    estadoLabel[
                      estado
                    ]
                  }
                </span>

                <span
                  style={
                    styles.kanbanCount
                  }
                >
                  {columna.length}
                </span>
              </div>

              {columna.map(
                (pedido) => (
                  <div
                    key={
                      pedido._id ||
                      pedido.id
                    }
                    style={
                      styles.kanbanCard
                    }
                  >

                    <button
                      onClick={() =>
                        abrirDetalle(
                          pedido
                        )
                      }
                      style={
                        styles.linkButton
                      }
                    >
                      {pedido.numero ||
                        pedido._id ||
                        pedido.id}
                    </button>

                    <div
                      style={{
                        marginTop: 8,
                        fontWeight: 600,
                      }}
                    >
                      {pedido.cliente_nombre ||
                        pedido.cliente ||
                        'Sin cliente'}
                    </div>

                    <div
                      style={
                        styles.kanbanAmount
                      }
                    >
                      {money(
                        pedido.total
                      )}
                    </div>

                    {pedido.saldo_pendiente >
                      0 && (
                      <div
                        style={
                          styles.kanbanBalance
                        }
                      >
                        Saldo:{' '}
                        {money(
                          pedido.saldo_pendiente
                        )}
                      </div>
                    )}

                    <div
                      style={
                        styles.kanbanActions
                      }
                    >
                      {estado ===
                        'confirmado' && (
                        <button
                          onClick={() =>
                            cambiarEstado(
                              pedido,
                              'en_proceso'
                            )
                          }
                          style={
                            styles.actionButton
                          }
                        >
                          Iniciar
                        </button>
                      )}

                      {estado ===
                        'en_proceso' && (
                        <button
                          onClick={() =>
                            cambiarEstado(
                              pedido,
                              'listo'
                            )
                          }
                          style={
                            styles.actionButton
                          }
                        >
                          Marcar listo
                        </button>
                      )}

                      {estado ===
                        'listo' && (
                        <button
                          onClick={() =>
                            cambiarEstado(
                              pedido,
                              'entregado'
                            )
                          }
                          style={
                            styles.actionButton
                          }
                        >
                          Entregar
                        </button>
                      )}

                      {estado ===
                        'entregado' && (
                        <button
                          onClick={() =>
                            cambiarEstado(
                              pedido,
                              'cobrado'
                            )
                          }
                          style={
                            styles.actionButton
                          }
                        >
                          Cobrar
                        </button>
                      )}
                    </div>

                  </div>
                )
              )}

              {columna.length === 0 && (
                <div
                  style={
                    styles.kanbanEmpty
                  }
                >
                  Sin pedidos
                </div>
              )}

            </div>
          )
        }
      )}

      {cargando && (
        <div
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            background: '#0f172a',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          Actualizando...
        </div>
      )}

    </div>
  )
}

/* =====================================================
   DETALLE
===================================================== */

function DetallePedido({
  pedido,
  cambiarEstado,
  cambiarEtapa,
  etapas,
  registrarPago,
  pagoForm,
  setPagoForm,
  abrirEditar,
}) {
  const pagos = Array.isArray(
    pedido.pagos
  )
    ? pedido.pagos
    : []

  const historial = Array.isArray(
    pedido.historial
  )
    ? pedido.historial
    : []

  return (
    <div>

      <div style={styles.detailTop}>

        <div>
          <div style={styles.detailClient}>
            {pedido.cliente_nombre ||
              pedido.cliente ||
              'Sin cliente'}
          </div>

          <div style={styles.muted}>
            Creado:{' '}
            {fecha(
              pedido.created_at
            )}
          </div>
        </div>

        <EstadoBadge
          estado={
            pedido.estado ||
            'confirmado'
          }
        />

      </div>

      {/* ESTADO */}
      <div style={styles.section}>

        <h3 style={styles.sectionTitle}>
          Estado
        </h3>

        <div style={styles.stateButtons}>
          {ESTADOS.map(
            (estado) => (
              <button
                key={estado}
                disabled={
                  estado ===
                  pedido.estado
                }
                onClick={() =>
                  cambiarEstado(
                    pedido,
                    estado
                  )
                }
                style={{
                  ...styles.stateButton,
                  opacity:
                    estado ===
                    pedido.estado
                      ? 0.45
                      : 1,
                  borderColor:
                    estadoColor[
                      estado
                    ],
                  color:
                    estadoColor[
                      estado
                    ],
                }}
              >
                {
                  estadoLabel[
                    estado
                  ]
                }
              </button>
            )
          )}
        </div>

      </div>

      {/* ETAPA */}
      <div style={styles.section}>

        <h3 style={styles.sectionTitle}>
          Etapa interna
        </h3>

        <select
          value={
            pedido.etapa_interna ||
            'recibido'
          }
          onChange={(e) =>
            cambiarEtapa(
              pedido,
              e.target.value
            )
          }
          style={styles.select}
        >
          {etapas.map(
            (etapa) => (
              <option
                key={etapa}
                value={etapa}
              >
                {nombreEtapa(etapa)}
              </option>
            )
          )}
        </select>

      </div>

      {/* ITEMS */}
      <div style={styles.section}>

        <h3 style={styles.sectionTitle}>
          Productos
        </h3>

        <div style={styles.detailItems}>

          {pedido.items.length ===
          0 ? (
            <div style={styles.muted}>
              Sin productos.
            </div>
          ) : (
            pedido.items.map(
              (item, index) => (
                <div
                  key={index}
                  style={
                    styles.detailItem
                  }
                >
                  <div>
                    <strong>
                      {item.nombre ||
                        'Producto'}
                    </strong>

                    <div
                      style={
                        styles.muted
                      }
                    >
                      {item.cantidad ||
                        0}{' '}
                      ×{' '}
                      {money(
                        item.precio_unitario
                      )}
                    </div>
                  </div>

                  <strong>
                    {money(
                      (
                        Number(
                          item.cantidad ||
                            0
                        ) *
                          Number(
                            item.precio_unitario ||
                              0
                          )
                      )
                    )}
                  </strong>
                </div>
              )
            )
          )}

        </div>

        <div
          style={
            styles.detailTotals
          }
        >
          <div>
            <span>Subtotal</span>
            <strong>
              {money(
                pedido.subtotal
              )}
            </strong>
          </div>

          <div>
            <span>IVA</span>
            <strong>
              {money(pedido.iva)}
            </strong>
          </div>

          <div style={styles.totalRow}>
            <span>Total</span>
            <strong>
              {money(pedido.total)}
            </strong>
          </div>

          <div>
            <span>Saldo</span>
            <strong
              style={{
                color:
                  pedido.saldo_pendiente >
                  0
                    ? '#dc2626'
                    : '#16a34a',
              }}
            >
              {money(
                pedido.saldo_pendiente
              )}
            </strong>
          </div>
        </div>

      </div>

      {/* PAGOS */}
      <div style={styles.section}>

        <h3 style={styles.sectionTitle}>
          Pagos
        </h3>

        {pagos.length > 0 && (
          <div style={styles.paymentList}>
            {pagos.map(
              (pago, index) => (
                <div
                  key={
                    pago.id ||
                    index
                  }
                  style={
                    styles.paymentRow
                  }
                >
                  <div>
                    <strong>
                      {money(
                        pago.monto
                      )}
                    </strong>

                    <div
                      style={
                        styles.muted
                      }
                    >
                      {pago.metodo ||
                        '-'}
                      {pago.referencia
                        ? ` · ${pago.referencia}`
                        : ''}
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {pedido.estado !==
          'cancelado' && (
          <form
            onSubmit={
              registrarPago
            }
            style={
              styles.paymentForm
            }
          >

            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Monto"
              value={
                pagoForm.monto
              }
              onChange={(e) =>
                setPagoForm(
                  (actual) => ({
                    ...actual,
                    monto:
                      e.target.value,
                  })
                )
              }
              style={styles.input}
            />

            <select
              value={
                pagoForm.metodo
              }
              onChange={(e) =>
                setPagoForm(
                  (actual) => ({
                    ...actual,
                    metodo:
                      e.target.value,
                  })
                )
              }
              style={styles.select}
            >
              <option value="efectivo">
                Efectivo
              </option>

              <option value="transferencia">
                Transferencia
              </option>

              <option value="tarjeta">
                Tarjeta
              </option>

              <option value="deposito">
                Depósito
              </option>

              <option value="otro">
                Otro
              </option>
            </select>

            <input
              placeholder="Referencia"
              value={
                pagoForm.referencia
              }
              onChange={(e) =>
                setPagoForm(
                  (actual) => ({
                    ...actual,
                    referencia:
                      e.target.value,
                  })
                )
              }
              style={styles.input}
            />

            <button
              type="submit"
              style={
                styles.primaryButton
              }
            >
              Registrar pago
            </button>

          </form>
        )}

      </div>

      {/* HISTORIAL */}
      <div style={styles.section}>

        <h3 style={styles.sectionTitle}>
          Historial
        </h3>

        {historial.length ===
        0 ? (
          <div style={styles.muted}>
            Sin movimientos registrados.
          </div>
        ) : (
          <div>
            {[
              ...historial,
            ]
              .reverse()
              .map(
                (
                  movimiento,
                  index
                ) => (
                  <div
                    key={index}
                    style={
                      styles.historyRow
                    }
                  >
                    <strong>
                      {estadoLabel[
                        movimiento
                          .estado_nuevo
                      ] ||
                        movimiento.estado_nuevo ||
                        'Movimiento'}
                    </strong>

                    <span
                      style={
                        styles.muted
                      }
                    >
                      {fecha(
                        movimiento.fecha
                      )}
                    </span>

                    {movimiento.nota && (
                      <span>
                        {movimiento.nota}
                      </span>
                    )}
                  </div>
                )
              )}
          </div>
        )}

      </div>

      <div style={styles.modalFooter}>
        <button
          onClick={() =>
            abrirEditar(pedido)
          }
          style={
            styles.secondaryButton
          }
        >
          Editar pedido
        </button>
      </div>

    </div>
  )
}

/* =====================================================
   COMPONENTES AUXILIARES
===================================================== */

function EstadoBadge({ estado }) {
  return (
    <span
      style={{
        ...styles.badge,
        background:
          `${estadoColor[estado] || '#64748b'}15`,
        color:
          estadoColor[estado] ||
          '#64748b',
      }}
    >
      {estadoLabel[estado] ||
        estado}
    </span>
  )
}

function Modal({
  titulo,
  cerrar,
  children,
  ancho = 800,
}) {
  return (
    <div style={styles.overlay}>
      <div
        style={{
          ...styles.modal,
          maxWidth: ancho,
        }}
      >

        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            {titulo}
          </h2>

          <button
            onClick={cerrar}
            style={styles.modalClose}
          >
            ×
          </button>
        </div>

        <div style={styles.modalBody}>
          {children}
        </div>

      </div>
    </div>
  )
}

/* =====================================================
   ESTILOS
===================================================== */

const styles = {

  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },

  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 600,
    color: '#0f172a',
  },

  subtitle: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: 14,
  },

  headerActions: {
    display: 'flex',
    gap: 8,
  },

  primaryButton: {
    border: 'none',
    background: '#0f172a',
    color: '#fff',
    padding: '9px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },

  secondaryButton: {
    background: '#fff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    padding: '8px 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },

  cancelButton: {
    background: '#fff',
    border: '1px solid #fecaca',
    color: '#dc2626',
    padding: '6px 9px',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
  },

  actionButton: {
    background: '#fff',
    border: '1px solid #cbd5e1',
    color: '#334155',
    padding: '5px 8px',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
  },

  error: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '10px 12px',
    borderRadius: 6,
    marginBottom: 16,
    fontSize: 13,
  },

  closeError: {
    border: 'none',
    background: 'transparent',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: 18,
  },

  filters: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },

  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    background: '#fff',
  },

  select: {
    padding: '8px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 13,
    background: '#fff',
    minWidth: 170,
  },

  counter: {
    marginLeft: 'auto',
    color: '#64748b',
    fontSize: 13,
    whiteSpace: 'nowrap',
  },

  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
  },

  tableHeader: {
    display: 'grid',
    gridTemplateColumns:
      '1.2fr 1.6fr 1fr 1fr 1fr 1fr 1.6fr',
    gap: 10,
    padding: '11px 14px',
    background: '#f8fafc',
    borderBottom:
      '1px solid #e2e8f0',
    color: '#64748b',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '.04em',
  },

  tableRow: {
    display: 'grid',
    gridTemplateColumns:
      '1.2fr 1.6fr 1fr 1fr 1fr 1fr 1.6fr',
    gap: 10,
    alignItems: 'center',
    padding: '13px 14px',
    borderBottom:
      '1px solid #f1f5f9',
    color: '#334155',
    fontSize: 13,
  },

  linkButton: {
    border: 'none',
    background: 'transparent',
    color: '#2563eb',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
    fontWeight: 600,
  },

  actions: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
  },

  badge: {
    display: 'inline-block',
    width: 'fit-content',
    padding: '4px 8px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
  },

  loading: {
    padding: 40,
    textAlign: 'center',
    color: '#64748b',
  },

  empty: {
    background: '#fff',
    border:
      '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 50,
    textAlign: 'center',
    color: '#64748b',
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 5,
  },

  formGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(2, 1fr)',
    gap: 14,
  },

  label: {
    display: 'block',
    fontSize: 12,
    color: '#475569',
    marginBottom: 5,
    fontWeight: 500,
  },

  section: {
    marginTop: 24,
    paddingTop: 20,
    borderTop:
      '1px solid #e2e8f0',
  },

  sectionHeader: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },

  sectionTitle: {
    margin: '0 0 12px',
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 600,
  },

  productPicker: {
    marginBottom: 12,
  },

  emptyItems: {
    padding: 18,
    border:
      '1px dashed #cbd5e1',
    borderRadius: 6,
    color: '#64748b',
    textAlign: 'center',
    fontSize: 13,
  },

  itemsTable: {
    border:
      '1px solid #e2e8f0',
    borderRadius: 6,
    overflow: 'hidden',
  },

  itemHeader: {
    display: 'grid',
    gridTemplateColumns:
      '2fr .7fr 1fr 1fr .3fr',
    gap: 10,
    padding: '9px 12px',
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 11,
  },

  itemRow: {
    display: 'grid',
    gridTemplateColumns:
      '2fr .7fr 1fr 1fr .3fr',
    gap: 10,
    alignItems: 'center',
    padding: '10px 12px',
    borderTop:
      '1px solid #f1f5f9',
    fontSize: 13,
  },

  smallInput: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 8px',
    border:
      '1px solid #cbd5e1',
    borderRadius: 5,
    fontSize: 12,
  },

  deleteButton: {
    border: 'none',
    background: '#fef2f2',
    color: '#dc2626',
    width: 25,
    height: 25,
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 16,
  },

  muted: {
    color: '#94a3b8',
    fontSize: 11,
  },

  totalsBox: {
    marginTop: 20,
    marginLeft: 'auto',
    maxWidth: 320,
    padding: 14,
    background: '#f8fafc',
    border:
      '1px solid #e2e8f0',
    borderRadius: 6,
  },

  totalRow: {
    borderTop:
      '1px solid #cbd5e1',
    marginTop: 8,
    paddingTop: 8,
    fontSize: 15,
    fontWeight: 700,
  },

  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 22,
    paddingTop: 16,
    borderTop:
      '1px solid #e2e8f0',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    background:
      'rgba(15,23,42,.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 1000,
  },

  modal: {
    width: '100%',
    maxHeight: '92vh',
    background: '#fff',
    borderRadius: 9,
    boxShadow:
      '0 20px 50px rgba(0,0,0,.2)',
    overflow: 'hidden',
  },

  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      'space-between',
    padding: '15px 20px',
    borderBottom:
      '1px solid #e2e8f0',
  },

  modalTitle: {
    margin: 0,
    fontSize: 18,
    color: '#0f172a',
  },

  modalClose: {
    border: 'none',
    background: 'transparent',
    color: '#64748b',
    fontSize: 25,
    cursor: 'pointer',
  },

  modalBody: {
    padding: 20,
    overflowY: 'auto',
    maxHeight: 'calc(92vh - 65px)',
  },

  kanban: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(4, minmax(220px, 1fr))',
    gap: 14,
    alignItems: 'start',
  },

  kanbanColumn: {
    background: '#f8fafc',
    border:
      '1px solid #e2e8f0',
    borderRadius: 8,
    minHeight: 350,
    padding: 10,
  },

  kanbanHeader: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    fontWeight: 600,
    color: '#334155',
    padding: '5px 4px 12px',
  },

  kanbanCount: {
    background: '#e2e8f0',
    borderRadius: 20,
    padding: '2px 7px',
    fontSize: 11,
    color: '#64748b',
  },

  kanbanCard: {
    background: '#fff',
    border:
      '1px solid #e2e8f0',
    borderRadius: 7,
    padding: 12,
    marginBottom: 9,
    boxShadow:
      '0 1px 2px rgba(0,0,0,.03)',
  },

  kanbanAmount: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },

  kanbanBalance: {
    marginTop: 4,
    color: '#dc2626',
    fontSize: 12,
  },

  kanbanActions: {
    display: 'flex',
    gap: 5,
    marginTop: 10,
  },

  kanbanEmpty: {
    textAlign: 'center',
    color: '#94a3b8',
    padding: 30,
    fontSize: 12,
  },

  detailTop: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    paddingBottom: 15,
    borderBottom:
      '1px solid #e2e8f0',
  },

  detailClient: {
    fontSize: 18,
    fontWeight: 600,
    color: '#0f172a',
  },

  stateButtons: {
    display: 'flex',
    gap: 7,
    flexWrap: 'wrap',
  },

  stateButton: {
    background: '#fff',
    border:
      '1px solid #cbd5e1',
    padding: '7px 10px',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 12,
  },

  detailItems: {
    border:
      '1px solid #e2e8f0',
    borderRadius: 6,
    overflow: 'hidden',
  },

  detailItem: {
    display: 'flex',
    justifyContent:
      'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderBottom:
      '1px solid #f1f5f9',
    fontSize: 13,
  },

  detailTotals: {
    marginTop: 12,
    marginLeft: 'auto',
    maxWidth: 300,
  },

  paymentList: {
    border:
      '1px solid #e2e8f0',
    borderRadius: 6,
    marginBottom: 12,
  },

  paymentRow: {
    padding: 10,
    borderBottom:
      '1px solid #f1f5f9',
  },

  paymentForm: {
    display: 'grid',
    gridTemplateColumns:
      '1fr 1fr 1.5fr auto',
    gap: 8,
  },

  historyRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '9px 0',
    borderBottom:
      '1px solid #f1f5f9',
    fontSize: 12,
  },

}
