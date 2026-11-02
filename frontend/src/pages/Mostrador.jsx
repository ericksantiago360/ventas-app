import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'
import { getClientesRecientes, guardarClienteReciente } from '../hooks/useSmartDefaults'

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

// Descuento manual sobre el precio ya con tramo de volumen (mismo redondeo que el backend)
function conDescuentoManual(unitario, pct) {
  return Math.round(unitario * (1 - pct / 100) * 100 + 1e-9) / 100
}

const CLIENTE_VACIO = { empresa: '', contacto: '', telefono: '', correo: '', canal_origen: 'directo' }
const PRODUCTO_VACIO = { codigo: '', nombre: '', precio: '', control_inventario: false, stock_inicial: '' }
const MANUAL_VACIO = { nombre: '', precio: '' }
const CANALES = ['directo', 'whatsapp', 'referido', 'instagram', 'visita', 'otro']

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
  const [descuentoPct, setDescuentoPct] = useState('') // descuento manual sobre toda la venta
  const [cliente, setCliente]       = useState(null)   // { id, empresa, contacto, telefono, ... }
  const [busquedaCliente, setBusquedaCliente]     = useState('')
  const [clientesEncontrados, setClientesEncontrados] = useState([])
  const [modal, setModal]           = useState(null)   // 'producto' | 'cliente' | null
  const [formProducto, setFormProducto] = useState(PRODUCTO_VACIO)
  const [formCliente, setFormCliente]   = useState(CLIENTE_VACIO)
  const [formManual, setFormManual]     = useState(MANUAL_VACIO)

  // Administración: productos del mostrador, clientes y tramos
  const [busquedaAdmin, setBusquedaAdmin]         = useState('')
  const [incluirInactivos, setIncluirInactivos]   = useState(false)
  const [productosAdmin, setProductosAdmin]       = useState([])
  const [prodEditando, setProdEditando]           = useState(null) // id del producto, o null para alta
  const [formProdAdmin, setFormProdAdmin]         = useState(PRODUCTO_VACIO)
  const [busquedaClienteAdmin, setBusquedaClienteAdmin] = useState('')
  const [clientesAdmin, setClientesAdmin]         = useState([])
  const [clienteEditando, setClienteEditando]     = useState(null) // id del cliente, o null para alta
  const [formCliAdmin, setFormCliAdmin]           = useState(CLIENTE_VACIO)
  const [tramoEditando, setTramoEditando]         = useState(null) // id del tramo, o null para alta

  // Sucursales del negocio: la venta y el resumen del día se hacen en la sucursal elegida
  const [sucursales, setSucursales]               = useState([])
  const [sucursalId, setSucursalId]               = useState('')
  const [sucursalesAdmin, setSucursalesAdmin]     = useState([])
  const [sucEditando, setSucEditando]             = useState(null)
  const [formSuc, setFormSuc]                     = useState({ nombre: '', direccion: '' })
  const [guardandoModal, setGuardandoModal] = useState(false)

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

  const cargarSucursales = async () => {
    try {
      const { data } = await api.get('/api/mostrador/sucursales', { params: { negocio_id: negocioId } })
      const lista = data || []
      setSucursales(lista)
      setSucursalId(actual => lista.some(x => x.id === actual) ? actual : (lista[0]?.id || ''))
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar las sucursales.'))
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
        api.get('/api/mostrador/ventas', { params: { negocio_id: negocioId, fecha, sucursal_id: sucursalId || undefined } }),
        api.get('/api/mostrador/resumen', { params: { negocio_id: negocioId, fecha, sucursal_id: sucursalId || undefined } }),
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
    setCliente(null)
    setDescuentoPct('')
    setSucursalId('')
    cargarSucursales()
    cargarProductos('')
    cargarCuentas()
    cargarTramos()
    setBusqueda('')
  }, [negocioId])

  useEffect(() => {
    if (tab === 'dia') cargarDia()
  }, [tab, fecha, negocioId, sucursalId])

  useEffect(() => {
    if (tab !== 'sucursales') return
    cargarSucursalesAdmin()
  }, [tab, negocioId])

  // Búsqueda con pausa para no pedir en cada tecla
  useEffect(() => {
    const t = setTimeout(() => cargarProductos(busqueda), 250)
    return () => clearTimeout(t)
  }, [busqueda, negocioId])

  // Administración: recarga al cambiar de pestaña, búsqueda o negocio
  useEffect(() => {
    if (tab !== 'productos') return
    const t = setTimeout(() => cargarProductosAdmin(), 250)
    return () => clearTimeout(t)
  }, [tab, busquedaAdmin, incluirInactivos, negocioId])

  useEffect(() => {
    if (tab !== 'clientes') return
    const t = setTimeout(() => cargarClientesAdmin(), 250)
    return () => clearTimeout(t)
  }, [tab, busquedaClienteAdmin, negocioId])

  // Búsqueda de clientes del CRM para asignarlos a la venta
  useEffect(() => {
    if (!busquedaCliente.trim()) { setClientesEncontrados([]); return }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/crm/clientes', {
          params: { q: busquedaCliente.trim(), negocio_id: negocioId, limit: 8 },
        })
        setClientesEncontrados(data?.data || [])
      } catch (err) {
        setError(mensajeError(err, 'No se pudieron buscar clientes.'))
      }
    }, 250)
    return () => clearTimeout(t)
  }, [busquedaCliente, negocioId])

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

  // Lector de código de barras: escribe el código y manda Enter. Si coincide, se agrega y se limpia.
  const escanear = async (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const codigo = busqueda.trim()
    if (!codigo) return
    try {
      const { data } = await api.get('/api/mostrador/productos/por-codigo', {
        params: { negocio_id: negocioId, codigo },
      })
      agregar(data)
      setBusqueda('')
    } catch (err) {
      setError(err.response?.status === 404
        ? `No hay un producto con el código "${codigo}".`
        : mensajeError(err, 'No se pudo buscar el código.'))
    }
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
  const pctManual = Number(descuentoPct) || 0
  const pctManualValido = pctManual >= 0 && pctManual < 100
  // Las líneas manuales no entran a tramos de volumen: su precio es el que se tecleó
  const unitarioBase = (l) =>
    l.producto.manual ? l.producto.precio : precioConDescuento(l.producto.precio, l.cantidad, tramos).unitario
  const unitarioFinal = (l) => conDescuentoManual(unitarioBase(l), pctManual)
  const total = useMemo(
    () => lineas.reduce((n, l) => n + unitarioFinal(l) * l.cantidad, 0),
    [lineas, tramos, pctManual]
  )

  const abrirModal = (cual) => { setError(''); setModal(cual) }
  const cerrarModal = () => { setModal(null) }

  // ── Sucursales: CRUD ────────────────────────────────────────────────────

  const cargarSucursalesAdmin = async () => {
    try {
      const { data } = await api.get('/api/mostrador/sucursales', {
        params: { negocio_id: negocioId, incluir_inactivas: true },
      })
      setSucursalesAdmin(data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar las sucursales.'))
    }
  }

  const cancelarEdicionSuc = () => {
    setSucEditando(null)
    setFormSuc({ nombre: '', direccion: '' })
  }

  const guardarSucursal = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (sucEditando) {
        await api.put(`/api/mostrador/sucursales/${sucEditando}`, { nombre: formSuc.nombre, direccion: formSuc.direccion })
      } else {
        await api.post('/api/mostrador/sucursales', { negocio_id: negocioId, nombre: formSuc.nombre, direccion: formSuc.direccion })
      }
      cancelarEdicionSuc()
      await cargarSucursalesAdmin()
      await cargarSucursales()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar la sucursal.'))
    }
  }

  const editarSucursal = (x) => {
    setError('')
    setSucEditando(x.id)
    setFormSuc({ nombre: x.nombre, direccion: x.direccion || '' })
  }

  const cambiarActivoSucursal = async (x, activo) => {
    if (!activo && !window.confirm(`¿Dar de baja la sucursal "${x.nombre}"? Sus ventas anteriores se conservan.`)) return
    setError('')
    try {
      if (activo) await api.put(`/api/mostrador/sucursales/${x.id}`, { activo: true })
      else await api.delete(`/api/mostrador/sucursales/${x.id}`)
      if (sucEditando === x.id) cancelarEdicionSuc()
      await cargarSucursalesAdmin()
      await cargarSucursales()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo actualizar la sucursal.'))
    }
  }

  // ── Productos del mostrador: CRUD ───────────────────────────────────────

  const cargarProductosAdmin = async () => {
    try {
      const { data } = await api.get('/api/mostrador/productos/admin', {
        params: { negocio_id: negocioId, busqueda: busquedaAdmin, incluir_inactivos: incluirInactivos },
      })
      setProductosAdmin(data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar los productos.'))
    }
  }

  const cancelarEdicionProd = () => {
    setProdEditando(null)
    setFormProdAdmin(PRODUCTO_VACIO)
  }

  const editarProd = (p) => {
    setError('')
    setProdEditando(p.id)
    setFormProdAdmin({ codigo: p.codigo, nombre: p.nombre, precio: String(p.precio), control_inventario: p.control_inventario, stock_inicial: '' })
  }

  const guardarProdAdmin = async (e) => {
    e.preventDefault()
    setError('')
    try {
      if (prodEditando) {
        await api.put(`/api/mostrador/productos/${prodEditando}`, {
          codigo: formProdAdmin.codigo.trim(),
          nombre: formProdAdmin.nombre.trim(),
          precio: Number(formProdAdmin.precio),
        })
      } else {
        await api.post('/api/mostrador/productos', {
          negocio_id: negocioId,
          codigo: formProdAdmin.codigo.trim(),
          nombre: formProdAdmin.nombre.trim(),
          precio: Number(formProdAdmin.precio),
          control_inventario: formProdAdmin.control_inventario,
          stock_inicial: Number(formProdAdmin.stock_inicial || 0),
        })
      }
      cancelarEdicionProd()
      await cargarProductosAdmin()
      await cargarProductos(busqueda)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el producto.'))
    }
  }

  const cambiarActivoProd = async (p, activo) => {
    if (!activo && !window.confirm(`¿Dar de baja "${p.nombre}"? Deja de venderse; el historial se conserva.`)) return
    setError('')
    try {
      if (activo) {
        await api.put(`/api/mostrador/productos/${p.id}`, { activo: true })
      } else {
        await api.delete(`/api/mostrador/productos/${p.id}`)
      }
      if (prodEditando === p.id) cancelarEdicionProd()
      await cargarProductosAdmin()
      await cargarProductos(busqueda)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo actualizar el producto.'))
    }
  }

  // ── Clientes del CRM: CRUD desde el mostrador ───────────────────────────

  const cargarClientesAdmin = async () => {
    try {
      const { data } = await api.get('/api/crm/clientes', {
        params: { q: busquedaClienteAdmin.trim() || undefined, negocio_id: negocioId, limit: 50 },
      })
      setClientesAdmin(data?.data || [])
    } catch (err) {
      setError(mensajeError(err, 'No se pudieron cargar los clientes.'))
    }
  }

  const cancelarEdicionCliente = () => {
    setClienteEditando(null)
    setFormCliAdmin(CLIENTE_VACIO)
  }

  const editarCliente = (c) => {
    setError('')
    setClienteEditando(c._id || c.id)
    setFormCliAdmin({
      empresa: c.empresa || '', contacto: c.contacto || '', telefono: c.telefono || '',
      correo: c.correo || '', canal_origen: c.canal_origen || 'directo',
    })
  }

  const guardarClienteAdmin = async (e) => {
    e.preventDefault()
    setError('')
    const cuerpo = {
      empresa: formCliAdmin.empresa.trim(),
      contacto: formCliAdmin.contacto.trim(),
      telefono: formCliAdmin.telefono.trim(),
      correo: formCliAdmin.correo.trim() || null,
      canal_origen: formCliAdmin.canal_origen,
    }
    try {
      if (clienteEditando) {
        await api.put(`/api/crm/clientes/${clienteEditando}`, cuerpo)
      } else {
        const { data } = await api.post('/api/crm/clientes', { ...cuerpo, tags: [], notas: '' })
        if (data.duplicate_warning) {
          setError('Ya existe un cliente con esa empresa y teléfono. Búscalo en la lista.')
          return
        }
      }
      cancelarEdicionCliente()
      await cargarClientesAdmin()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el cliente.'))
    }
  }

  const darDeBajaCliente = async (c) => {
    if (!window.confirm(`¿Dar de baja a "${c.empresa}"? Deja de aparecer en la búsqueda de ventas.`)) return
    setError('')
    try {
      await api.delete(`/api/crm/clientes/${c._id || c.id}`)
      if (clienteEditando === (c._id || c.id)) cancelarEdicionCliente()
      await cargarClientesAdmin()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo dar de baja el cliente.'))
    }
  }

  // ── Artículo manual: línea con nombre y precio tecleados, sin inventario ─

  const guardarManual = (e) => {
    e.preventDefault()
    setError('')
    const precio = Number(formManual.precio)
    if (!formManual.nombre.trim() || !(precio > 0)) { setError('Escribe el nombre y un precio mayor a cero.'); return }
    const clave = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCarrito(c => ({
      ...c,
      [clave]: {
        producto: { id: clave, nombre: formManual.nombre.trim(), precio, sku: '', control_inventario: false, stock: null, manual: true },
        cantidad: 1,
      },
    }))
    setFormManual(MANUAL_VACIO)
    cerrarModal()
  }

  // ── Alta rápida de producto desde el mostrador ───────────────────────────

  const guardarProducto = async (e) => {
    e.preventDefault()
    setError('')
    setGuardandoModal(true)
    try {
      const { data: creado } = await api.post('/api/mostrador/productos', {
        negocio_id: negocioId,
        codigo: formProducto.codigo.trim(),
        nombre: formProducto.nombre.trim(),
        precio: Number(formProducto.precio), // IVA incluido
        control_inventario: formProducto.control_inventario,
        stock_inicial: Number(formProducto.stock_inicial || 0),
      })
      agregar(creado)
      setFormProducto(PRODUCTO_VACIO)
      cerrarModal()
      await cargarProductos(busqueda)
    } catch (err) {
      setError(mensajeError(err, 'No se pudo crear el producto.'))
    } finally {
      setGuardandoModal(false)
    }
  }

  // ── Alta rápida de cliente (CRM) desde el mostrador ──────────────────────

  const guardarCliente = async (e) => {
    e.preventDefault()
    setError('')
    setGuardandoModal(true)
    try {
      const { data } = await api.post('/api/crm/clientes', {
        empresa: formCliente.empresa.trim(),
        contacto: formCliente.contacto.trim(),
        telefono: formCliente.telefono.trim(),
        correo: formCliente.correo.trim() || null,
        canal_origen: formCliente.canal_origen,
        tags: [],
        notas: '',
      })
      if (data.duplicate_warning) {
        if (!data.cliente_existente) {
          setError('Ya existe un cliente con esa empresa y teléfono, pero no tienes acceso a él.')
          return
        }
        // Ya existe: se usa ese mismo cliente en vez de duplicarlo
        seleccionarCliente(data.cliente_existente)
        setFormCliente(CLIENTE_VACIO)
        cerrarModal()
        return
      }
      seleccionarCliente(data.data)
      setFormCliente(CLIENTE_VACIO)
      cerrarModal()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo crear el cliente.'))
    } finally {
      setGuardandoModal(false)
    }
  }

  const seleccionarCliente = (c) => {
    guardarClienteReciente(c)
    setCliente({ ...c, id: c._id || c.id })
    setBusquedaCliente('')
    setClientesEncontrados([])
  }

  // ── Descuentos por volumen ────────────────────────────────────────────────

  const guardarTramo = async (e) => {
    e.preventDefault()
    setError('')
    const cuerpo = {
      nombre: formTramo.nombre,
      cantidad_minima: Number(formTramo.cantidad_minima),
      porcentaje: Number(formTramo.porcentaje),
    }
    try {
      if (tramoEditando) {
        await api.put(`/api/mostrador/descuentos-volumen/${tramoEditando}`, cuerpo)
      } else {
        await api.post('/api/mostrador/descuentos-volumen', { negocio_id: negocioId, ...cuerpo })
      }
      cancelarEdicionTramo()
      await cargarTramos()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo guardar el tramo.'))
    }
  }

  const editarTramo = (t) => {
    setError('')
    setTramoEditando(t.id)
    setFormTramo({ nombre: t.nombre, cantidad_minima: String(t.cantidad_minima), porcentaje: String(t.porcentaje) })
  }

  const cancelarEdicionTramo = () => {
    setTramoEditando(null)
    setFormTramo({ nombre: '', cantidad_minima: '', porcentaje: '' })
  }

  const eliminarTramo = async (t) => {
    if (!window.confirm(`¿Eliminar el tramo "${t.nombre}"? Las ventas ya cobradas no cambian.`)) return
    setError('')
    try {
      await api.delete(`/api/mostrador/descuentos-volumen/${t.id}`)
      if (tramoEditando === t.id) cancelarEdicionTramo()
      await cargarTramos()
    } catch (err) {
      setError(mensajeError(err, 'No se pudo eliminar el tramo.'))
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
    if (!pctManualValido) { setError('El descuento debe ser de 0 a 99.99%.'); return }
    if (sucursales.length > 0 && !sucursalId) { setError('Elige la sucursal donde se vende.'); return }
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
        items: lineas.map(l => (l.producto.manual
          ? { manual: { nombre: l.producto.nombre, precio: l.producto.precio }, cantidad: l.cantidad }
          : { producto_id: l.producto.id, cantidad: l.cantidad })),
        monto_recibido: metodo === 'efectivo' ? Number(recibido) : null,
        descuento_manual_pct: pctManual,
        cliente_id: cliente?.id || null,
        sucursal_id: sucursalId || null,
      })
      setTicket(data)
      setCarrito({})
      setRecibido('')
      setDescuentoPct('')
      setCliente(null)
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
          {sucursales.length > 0 && (
            <select value={sucursalId} onChange={e => setSucursalId(e.target.value)} style={s.select} title="Sucursal donde se vende">
              {sucursales.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div style={s.errorBox}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={s.closeBtn}>×</button>
        </div>
      )}

      <div style={s.tabs}>
        {[['vender', 'Vender'], ['dia', 'Ventas del día'], ['productos', 'Productos'], ['clientes', 'Clientes'], ['sucursales', 'Sucursales'], ['descuentos', 'Descuentos por volumen']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{ ...s.tab, ...(tab === v ? s.tabActive : {}) }}>
            {l}
          </button>
        ))}
      </div>

      {/* MODALES: alta rápida de producto y cliente */}
      {modal && (
        <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget && !guardandoModal) cerrarModal() }}>
          {modal === 'manual' ? (
            <form onSubmit={guardarManual} style={s.modal}>
              <h2 style={s.panelTitle}>Artículo manual</h2>
              <p style={{ ...s.muted, margin: '0 0 12px', fontSize: 13 }}>
                Se vende con el nombre y precio que escribas. No se guarda en el catálogo ni descuenta inventario.
              </p>
              <label style={s.label}>Nombre</label>
              <input style={{ ...s.input, marginBottom: 10 }} required maxLength={120} value={formManual.nombre}
                onChange={e => setFormManual(f => ({ ...f, nombre: e.target.value }))} />
              <label style={s.label}>Precio (IVA incluido)</label>
              <input style={{ ...s.input, marginBottom: 10 }} type="number" min={0.01} step="0.01" required
                value={formManual.precio} onChange={e => setFormManual(f => ({ ...f, precio: e.target.value }))} />
              {error && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
              <div style={s.modalAcciones}>
                <button type="button" onClick={cerrarModal} style={s.smallBtn}>Cancelar</button>
                <button type="submit" style={s.cobrarBtnCompacto}>Agregar a la venta</button>
              </div>
            </form>
          ) : modal === 'producto' ? (
            <form onSubmit={guardarProducto} style={s.modal}>
              <h2 style={s.panelTitle}>Nuevo producto</h2>
              <label style={s.label}>Código</label>
              <input style={{ ...s.input, marginBottom: 10 }} required value={formProducto.codigo}
                onChange={e => setFormProducto(f => ({ ...f, codigo: e.target.value }))} />
              <label style={s.label}>Nombre</label>
              <input style={{ ...s.input, marginBottom: 10 }} required value={formProducto.nombre}
                onChange={e => setFormProducto(f => ({ ...f, nombre: e.target.value }))} />
              <label style={s.label}>Precio de venta (IVA incluido)</label>
              <input style={{ ...s.input, marginBottom: 10 }} type="number" min={0.01} step="0.01" required
                value={formProducto.precio} onChange={e => setFormProducto(f => ({ ...f, precio: e.target.value }))} />
              <label style={s.label}>Tipo</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {[
                  { valor: false, titulo: 'Artículo', desc: 'Sin control de inventario' },
                  { valor: true, titulo: 'Inventariado', desc: 'Controla stock' },
                ].map(op => (
                  <button
                    key={op.titulo} type="button"
                    onClick={() => setFormProducto(f => ({ ...f, control_inventario: op.valor }))}
                    style={{
                      ...s.metodoBtn, flex: 1, textAlign: 'left',
                      border: `2px solid ${formProducto.control_inventario === op.valor ? '#0f172a' : '#e2e8f0'}`,
                      background: formProducto.control_inventario === op.valor ? '#f1f5f9' : '#fff',
                    }}
                  >
                    <strong style={{ display: 'block', fontSize: 13 }}>{op.titulo}</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{op.desc}</span>
                  </button>
                ))}
              </div>
              {formProducto.control_inventario && (
                <>
                  <label style={s.label}>Stock inicial</label>
                  <input style={{ ...s.input, marginBottom: 10 }} type="number" min={0} step="1"
                    value={formProducto.stock_inicial}
                    onChange={e => setFormProducto(f => ({ ...f, stock_inicial: e.target.value }))} />
                </>
              )}
              {error && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
              <div style={s.modalAcciones}>
                <button type="button" onClick={cerrarModal} style={s.smallBtn} disabled={guardandoModal}>Cancelar</button>
                <button type="submit" style={s.cobrarBtnCompacto} disabled={guardandoModal}>
                  {guardandoModal ? 'Guardando…' : 'Crear y agregar'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={guardarCliente} style={s.modal}>
              <h2 style={s.panelTitle}>Nuevo cliente</h2>
              <label style={s.label}>Empresa o nombre</label>
              <input style={{ ...s.input, marginBottom: 10 }} required value={formCliente.empresa}
                onChange={e => setFormCliente(f => ({ ...f, empresa: e.target.value }))} />
              <label style={s.label}>Contacto</label>
              <input style={{ ...s.input, marginBottom: 10 }} value={formCliente.contacto}
                onChange={e => setFormCliente(f => ({ ...f, contacto: e.target.value }))} />
              <label style={s.label}>Teléfono</label>
              <input style={{ ...s.input, marginBottom: 10 }} required value={formCliente.telefono}
                onChange={e => setFormCliente(f => ({ ...f, telefono: e.target.value }))} />
              <label style={s.label}>Correo (opcional)</label>
              <input style={{ ...s.input, marginBottom: 10 }} type="email" value={formCliente.correo}
                onChange={e => setFormCliente(f => ({ ...f, correo: e.target.value }))} />
              <label style={s.label}>Canal de origen</label>
              <select style={{ ...s.input, marginBottom: 10 }} value={formCliente.canal_origen}
                onChange={e => setFormCliente(f => ({ ...f, canal_origen: e.target.value }))}>
                {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {error && <div style={{ color: '#991b1b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
              <div style={s.modalAcciones}>
                <button type="button" onClick={cerrarModal} style={s.smallBtn} disabled={guardandoModal}>Cancelar</button>
                <button type="submit" style={s.cobrarBtnCompacto} disabled={guardandoModal}>
                  {guardandoModal ? 'Guardando…' : 'Guardar y usar'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* VENDER */}
      {tab === 'vender' && (
        <div style={s.venderGrid}>
          {/* Productos */}
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input
                style={s.input}
                placeholder="Buscar por nombre o código, o escanear código de barras…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                onKeyDown={escanear}
                autoFocus
              />
              <button onClick={() => abrirModal('manual')} style={s.smallBtn}>+ Artículo manual</button>
              <button onClick={() => abrirModal('producto')} style={s.smallBtn}>+ Producto</button>
            </div>
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

            <div style={{ marginBottom: 14 }}>
              <label style={s.label}>Cliente (opcional)</label>
              {cliente ? (
                <div style={s.clienteChip}>
                  <span><strong>{cliente.empresa}</strong>{cliente.contacto ? ` · ${cliente.contacto}` : ''}</span>
                  <button onClick={() => setCliente(null)} style={s.linkBtn}>Quitar</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      style={s.input} placeholder="Buscar cliente…"
                      value={busquedaCliente} onChange={e => setBusquedaCliente(e.target.value)}
                    />
                    <button onClick={() => abrirModal('cliente')} style={s.smallBtn}>+ Nuevo</button>
                  </div>
                  {!busquedaCliente.trim() && getClientesRecientes().length > 0 && (
                    <>
                      <div style={{ ...s.muted, fontSize: 11, fontWeight: 600, padding: '4px 2px' }}>RECIENTES</div>
                      {getClientesRecientes().map(c => (
                        <button key={`reciente-${c._id || c.id}`} onClick={() => seleccionarCliente(c)} style={s.clienteOpcion}>
                          <span>{c.empresa || c.nombre || 'Sin nombre'}</span>
                          <span style={s.muted}>{c.telefono}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {clientesEncontrados.map(c => (
                    <button key={c._id || c.id} onClick={() => seleccionarCliente(c)} style={s.clienteOpcion}>
                      <span>{c.empresa}</span>
                      <span style={s.muted}>{c.telefono}</span>
                    </button>
                  ))}
                </>
              )}
            </div>

            {lineas.length === 0 ? (
              <div style={{ ...s.muted, padding: '20px 0' }}>Toca un producto para agregarlo.</div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                {lineas.map(l => (
                  <div key={l.producto.id} style={s.lineaRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={s.lineaNombre}>{l.producto.nombre}</div>
                      {(() => {
                        if (l.producto.manual) return <div style={s.muted}>{money(l.producto.precio)} c/u · artículo manual</div>
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
                      {money(unitarioFinal(l) * l.cantidad)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <label style={{ ...s.label, marginBottom: 0, flex: 1 }}>Descuento manual (%)</label>
              <input
                style={{ ...s.input, width: 90 }} type="number" min={0} max={99.99} step="0.01"
                value={descuentoPct} onChange={e => setDescuentoPct(e.target.value)} placeholder="0"
              />
            </div>

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
                <button onClick={() => { setCarrito({}); setRecibido(''); setDescuentoPct('') }} style={s.vaciarBtn}>Vaciar venta</button>
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

      {/* SUCURSALES: CRUD */}
      {tab === 'sucursales' && (
        <div style={s.venderGrid}>
          <div>
            <p style={{ ...s.muted, marginTop: 0 }}>
              Cada venta se registra en una sucursal. El inventario sigue siendo único por negocio.
            </p>
            {sucursalesAdmin.length === 0 ? (
              <div style={s.empty}>Aún no hay sucursales. Sin sucursales, las ventas no llevan sucursal.</div>
            ) : (
              <div style={s.card}>
                <div style={{ ...s.tableHead, gridTemplateColumns: '1.2fr 1.6fr .8fr 1fr' }}>
                  <span>Nombre</span><span>Dirección</span><span>Estado</span><span></span>
                </div>
                {sucursalesAdmin.map(x => (
                  <div key={x.id} style={{ ...s.tableRow, gridTemplateColumns: '1.2fr 1.6fr .8fr 1fr', opacity: x.activo ? 1 : 0.55 }}>
                    <span>{x.nombre}</span>
                    <span>{x.direccion || '—'}</span>
                    <span style={{ ...s.badge, color: x.activo ? '#16a34a' : '#64748b', background: x.activo ? '#f0fdf4' : '#f1f5f9' }}>
                      {x.activo ? 'Activa' : 'De baja'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => editarSucursal(x)} style={s.actionBtn}>Editar</button>
                      {x.activo
                        ? <button onClick={() => cambiarActivoSucursal(x, false)} style={s.actionBtnDanger}>Dar de baja</button>
                        : <button onClick={() => cambiarActivoSucursal(x, true)} style={s.actionBtn}>Reactivar</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={guardarSucursal} style={s.ventaPanel}>
            <h2 style={s.panelTitle}>{sucEditando ? 'Editar sucursal' : 'Nueva sucursal'}</h2>
            <label style={s.label}>Nombre</label>
            <input style={{ ...s.input, marginBottom: 12 }} required maxLength={80} value={formSuc.nombre}
              onChange={e => setFormSuc(f => ({ ...f, nombre: e.target.value }))} />
            <label style={s.label}>Dirección (opcional)</label>
            <input style={{ ...s.input, marginBottom: 12 }} maxLength={200} value={formSuc.direccion}
              onChange={e => setFormSuc(f => ({ ...f, direccion: e.target.value }))} />
            <button type="submit" style={s.cobrarBtn}>{sucEditando ? 'Guardar cambios' : 'Crear sucursal'}</button>
            {sucEditando && <button type="button" onClick={cancelarEdicionSuc} style={s.vaciarBtn}>Cancelar edición</button>}
          </form>
        </div>
      )}

      {/* PRODUCTOS: CRUD */}
      {tab === 'productos' && (
        <div style={s.venderGrid}>
          <div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
              <input style={s.input} placeholder="Buscar por nombre o código…" value={busquedaAdmin}
                onChange={e => setBusquedaAdmin(e.target.value)} />
              <label style={{ ...s.muted, alignItems: 'center', whiteSpace: 'nowrap', color: '#334155', fontSize: 13 }}>
                <input type="checkbox" checked={incluirInactivos} onChange={e => setIncluirInactivos(e.target.checked)} />
                Ver dados de baja
              </label>
            </div>
            {productosAdmin.length === 0 ? (
              <div style={s.empty}>No hay productos que coincidan.</div>
            ) : (
              <div style={s.card}>
                <div style={{ ...s.tableHead, gridTemplateColumns: '1.1fr 1.4fr .8fr .9fr .8fr 1.1fr' }}>
                  <span>Código</span><span>Nombre</span><span>Precio</span><span>Tipo</span><span>Estado</span><span></span>
                </div>
                {productosAdmin.map(p => (
                  <div key={p.id} style={{ ...s.tableRow, gridTemplateColumns: '1.1fr 1.4fr .8fr .9fr .8fr 1.1fr', opacity: p.activo ? 1 : 0.55 }}>
                    <span>{p.codigo}</span>
                    <span>{p.nombre}</span>
                    <strong>{money(p.precio)}</strong>
                    <span>{p.control_inventario ? `Inventariado · ${p.stock}` : 'Artículo'}</span>
                    <span style={{ ...s.badge, color: p.activo ? '#16a34a' : '#64748b', background: p.activo ? '#f0fdf4' : '#f1f5f9' }}>
                      {p.activo ? 'Activo' : 'De baja'}
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => editarProd(p)} style={s.actionBtn}>Editar</button>
                      {p.activo
                        ? <button onClick={() => cambiarActivoProd(p, false)} style={s.actionBtnDanger}>Dar de baja</button>
                        : <button onClick={() => cambiarActivoProd(p, true)} style={s.actionBtn}>Reactivar</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={guardarProdAdmin} style={s.ventaPanel}>
            <h2 style={s.panelTitle}>{prodEditando ? 'Editar producto' : 'Nuevo producto'}</h2>
            <label style={s.label}>Código</label>
            <input style={{ ...s.input, marginBottom: 12 }} required value={formProdAdmin.codigo}
              onChange={e => setFormProdAdmin(f => ({ ...f, codigo: e.target.value }))} />
            <label style={s.label}>Nombre</label>
            <input style={{ ...s.input, marginBottom: 12 }} required value={formProdAdmin.nombre}
              onChange={e => setFormProdAdmin(f => ({ ...f, nombre: e.target.value }))} />
            <label style={s.label}>Precio de venta (IVA incluido)</label>
            <input style={{ ...s.input, marginBottom: 12 }} type="number" min={0.01} step="0.01" required value={formProdAdmin.precio}
              onChange={e => setFormProdAdmin(f => ({ ...f, precio: e.target.value }))} />
            {!prodEditando && (
              <>
                <label style={s.label}>Tipo</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {[{ valor: false, titulo: 'Artículo' }, { valor: true, titulo: 'Inventariado' }].map(op => (
                    <button key={op.titulo} type="button"
                      onClick={() => setFormProdAdmin(f => ({ ...f, control_inventario: op.valor }))}
                      style={{ ...s.metodoBtn, flex: 1, border: `2px solid ${formProdAdmin.control_inventario === op.valor ? '#0f172a' : '#e2e8f0'}`,
                        background: formProdAdmin.control_inventario === op.valor ? '#f1f5f9' : '#fff' }}>
                      {op.titulo}
                    </button>
                  ))}
                </div>
                {formProdAdmin.control_inventario && (
                  <>
                    <label style={s.label}>Stock inicial</label>
                    <input style={{ ...s.input, marginBottom: 12 }} type="number" min={0} step="1" value={formProdAdmin.stock_inicial}
                      onChange={e => setFormProdAdmin(f => ({ ...f, stock_inicial: e.target.value }))} />
                  </>
                )}
              </>
            )}
            <button type="submit" style={s.cobrarBtn}>{prodEditando ? 'Guardar cambios' : 'Crear producto'}</button>
            {prodEditando && <button type="button" onClick={cancelarEdicionProd} style={s.vaciarBtn}>Cancelar edición</button>}
          </form>
        </div>
      )}

      {/* CLIENTES: CRUD (CRM) */}
      {tab === 'clientes' && (
        <div style={s.venderGrid}>
          <div>
            <p style={{ ...s.muted, marginTop: 0 }}>
              Clientes con actividad en tus negocios o creados por ti. Dar de baja un cliente lo quita de las búsquedas de venta.
            </p>
            <input style={{ ...s.input, marginBottom: 14 }} placeholder="Buscar por empresa, contacto, teléfono o correo…"
              value={busquedaClienteAdmin} onChange={e => setBusquedaClienteAdmin(e.target.value)} />
            {clientesAdmin.length === 0 ? (
              <div style={s.empty}>No hay clientes que coincidan.</div>
            ) : (
              <div style={s.card}>
                <div style={{ ...s.tableHead, gridTemplateColumns: '1.3fr 1fr 1fr .8fr 1fr' }}>
                  <span>Empresa</span><span>Contacto</span><span>Teléfono</span><span>Canal</span><span></span>
                </div>
                {clientesAdmin.map(c => {
                  const id = c._id || c.id
                  return (
                    <div key={id} style={{ ...s.tableRow, gridTemplateColumns: '1.3fr 1fr 1fr .8fr 1fr' }}>
                      <span>{c.empresa}</span>
                      <span>{c.contacto || '—'}</span>
                      <span>{c.telefono}</span>
                      <span>{c.canal_origen}</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => editarCliente(c)} style={s.actionBtn}>Editar</button>
                        <button onClick={() => darDeBajaCliente(c)} style={s.actionBtnDanger}>Dar de baja</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <form onSubmit={guardarClienteAdmin} style={s.ventaPanel}>
            <h2 style={s.panelTitle}>{clienteEditando ? 'Editar cliente' : 'Nuevo cliente'}</h2>
            <label style={s.label}>Empresa o nombre</label>
            <input style={{ ...s.input, marginBottom: 12 }} required value={formCliAdmin.empresa}
              onChange={e => setFormCliAdmin(f => ({ ...f, empresa: e.target.value }))} />
            <label style={s.label}>Contacto</label>
            <input style={{ ...s.input, marginBottom: 12 }} value={formCliAdmin.contacto}
              onChange={e => setFormCliAdmin(f => ({ ...f, contacto: e.target.value }))} />
            <label style={s.label}>Teléfono</label>
            <input style={{ ...s.input, marginBottom: 12 }} required value={formCliAdmin.telefono}
              onChange={e => setFormCliAdmin(f => ({ ...f, telefono: e.target.value }))} />
            <label style={s.label}>Correo (opcional)</label>
            <input style={{ ...s.input, marginBottom: 12 }} type="email" value={formCliAdmin.correo}
              onChange={e => setFormCliAdmin(f => ({ ...f, correo: e.target.value }))} />
            <label style={s.label}>Canal de origen</label>
            <select style={{ ...s.input, marginBottom: 12 }} value={formCliAdmin.canal_origen}
              onChange={e => setFormCliAdmin(f => ({ ...f, canal_origen: e.target.value }))}>
              {CANALES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="submit" style={s.cobrarBtn}>{clienteEditando ? 'Guardar cambios' : 'Crear cliente'}</button>
            {clienteEditando && <button type="button" onClick={cancelarEdicionCliente} style={s.vaciarBtn}>Cancelar edición</button>}
          </form>
        </div>
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => editarTramo(t)} style={s.actionBtn}>Editar</button>
                      <button onClick={() => alternarTramo(t)} style={s.actionBtn}>{t.activo ? 'Desactivar' : 'Activar'}</button>
                      <button onClick={() => eliminarTramo(t)} style={s.actionBtnDanger}>Eliminar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={guardarTramo} style={s.ventaPanel}>
            <h2 style={s.panelTitle}>{tramoEditando ? 'Editar tramo' : 'Nuevo tramo'}</h2>
            <label style={s.label}>Nombre</label>
            <input style={{ ...s.input, marginBottom: 12 }} placeholder="Ej. Mayoreo" value={formTramo.nombre}
              onChange={e => setFormTramo(f => ({ ...f, nombre: e.target.value }))} required />
            <label style={s.label}>Desde (piezas de un mismo producto)</label>
            <input style={{ ...s.input, marginBottom: 12 }} type="number" min={2} step={1} value={formTramo.cantidad_minima}
              onChange={e => setFormTramo(f => ({ ...f, cantidad_minima: e.target.value }))} required />
            <label style={s.label}>Porcentaje de descuento</label>
            <input style={{ ...s.input, marginBottom: 16 }} type="number" min={0.01} max={99.99} step="0.01" value={formTramo.porcentaje}
              onChange={e => setFormTramo(f => ({ ...f, porcentaje: e.target.value }))} required />
            <button type="submit" style={s.cobrarBtn}>{tramoEditando ? 'Guardar cambios' : 'Agregar tramo'}</button>
            {tramoEditando && <button type="button" onClick={cancelarEdicionTramo} style={s.vaciarBtn}>Cancelar edición</button>}
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
            {ticket.sucursal_nombre && <div style={s.ticketRow}><span>Sucursal</span><span>{ticket.sucursal_nombre}</span></div>}
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
  smallBtn: { border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a', padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  cobrarBtnCompacto: { border: 'none', background: '#0f172a', color: '#fff', padding: '9px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  linkBtn: { border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13 },
  clienteChip: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#f1f5f9', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#0f172a' },
  clienteOpcion: { display: 'flex', justifyContent: 'space-between', width: '100%', marginTop: 4, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 6, padding: '7px 10px', cursor: 'pointer', fontSize: 13, color: '#0f172a' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  modal: { background: '#fff', borderRadius: 10, padding: 22, width: '100%', maxWidth: 420, boxSizing: 'border-box' },
  modalAcciones: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
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
  actionBtnDanger: { background: '#fff', border: '1px solid #fecaca', color: '#dc2626', padding: '5px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 12 },
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
