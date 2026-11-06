import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { useNegocio } from '../context/NegocioContext'
import { MONEDAS } from '../constants/catalogos'

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

const TIPOS_CUENTA = [
  { value: 'caja', label: 'Caja' },
  { value: 'banco', label: 'Banco' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'wallet', label: 'Billetera digital' },
  { value: 'otro', label: 'Otra' },
]

const CATEGORIAS_INGRESO = [
  { value: 'venta', label: 'Venta' },
  { value: 'cobro_pedido', label: 'Cobro de pedido' },
  { value: 'anticipo', label: 'Anticipo' },
  { value: 'otro', label: 'Otro ingreso' },
]

const CATEGORIAS_EGRESO = [
  { value: 'compra', label: 'Compra' },
  { value: 'gasto', label: 'Gasto' },
  { value: 'proveedor', label: 'Pago a proveedor' },
  { value: 'nomina', label: 'Nómina' },
  { value: 'otro', label: 'Otro egreso' },
]

const cuentaInicial = {
  nombre: '',
  tipo: 'banco',
  moneda: 'MXN',
  saldo_inicial: 0,
  descripcion: '',
  activo: true,
}

const movimientoInicial = {
  tipo: 'ingreso',
  cuenta_id: '',
  categoria: 'venta',
  importe: '',
  fecha: new Date().toISOString().slice(0, 10),
  concepto: '',
}

const cobroInicial = {
  cuenta_id: '',
  importe: '',
  pedido_id: '',
  cliente_id: '',
  metodo_pago: 'efectivo',
  referencia: '',
  concepto: '',
  fecha: new Date().toISOString().slice(0, 10),
}

export default function Finanzas() {
  // FIX: el negocio activo ahora viene del context compartido, no de un
  // useState congelado al montar — así reacciona si cambias de negocio
  // en el selector sin necesidad de recargar la página.
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [dashboard, setDashboard] = useState(null)
  const [cuentas, setCuentas] = useState([])
  const [movimientos, setMovimientos] = useState([])
  // ?ref=<id de movimiento>: viene desde Compras; se resalta y se lleva a la vista
  const [refMovimiento] = useState(() => new URLSearchParams(window.location.search).get('ref'))

  useEffect(() => {
    if (!refMovimiento || movimientos.length === 0) return
    document.getElementById(`mov-${refMovimiento}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [refMovimiento, movimientos])
  const [guardandoCobro, setGuardandoCobro] = useState(false)

  const [cargando, setCargando] = useState(true)
  const [guardandoCuenta, setGuardandoCuenta] = useState(false)
  const [guardandoMovimiento, setGuardandoMovimiento] = useState(false)
  const [modalCobro, setModalCobro] = useState(false)

  const [modalCuenta, setModalCuenta] = useState(false)
  const [modalMovimiento, setModalMovimiento] = useState(false)

  const [editandoCuenta, setEditandoCuenta] = useState(null)
  const [formCuenta, setFormCuenta] = useState(cuentaInicial)
  const [formMovimiento, setFormMovimiento] =
    useState(movimientoInicial)
  const [editandoMovimiento, setEditandoMovimiento] = useState(null)

  const [formCobro, setFormCobro] =
    useState(cobroInicial)
  const cargarDatos = async () => {
    try {
      setCargando(true)

      const [dashboardRes, cuentasRes, movimientosRes] =
        await Promise.all([
          api.get('/api/finanzas/dashboard', {
            params: { negocio_id: negocioId },
          }),

          api.get('/api/finanzas/cuentas', {
            params: { negocio_id: negocioId },
          }),

          api.get('/api/finanzas/movimientos', {
            params: {
              negocio_id: negocioId,
              limit: 100,
            },
          }),
        ])

      setDashboard(dashboardRes.data)
      setCuentas(cuentasRes.data || [])
      setMovimientos(movimientosRes.data || [])
    } catch (error) {
      console.error('Error cargando Finanzas:', error)

      if (error.response?.status === 401) {
        alert('Sesión no válida. Vuelve a iniciar sesión.')
      } else {
        alert(
          error.response?.data?.detail ||
            'No se pudieron cargar los datos financieros.'
        )
      }
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    cargarDatos()
  }, [negocioId])

  const dinero = (valor, moneda = 'MXN') => {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: moneda,
      minimumFractionDigits: 2,
    }).format(Number(valor) || 0)
  }

  const formatearFecha = (valor) => {
    if (!valor) return '--'

    const fecha = new Date(valor)

    if (Number.isNaN(fecha.getTime())) {
      return String(valor)
    }

    return fecha.toLocaleDateString('es-MX')
  }

  // ============================================================
  // CUENTAS
  // ============================================================

  const abrirNuevaCuenta = () => {
    setEditandoCuenta(null)
    setFormCuenta(cuentaInicial)
    setModalCuenta(true)
  }

  const abrirEditarCuenta = (cuenta) => {
    setEditandoCuenta(cuenta)

    setFormCuenta({
      nombre: cuenta.nombre || '',
      tipo: cuenta.tipo || 'banco',
      moneda: cuenta.moneda || 'MXN',
      saldo_inicial: cuenta.saldo_inicial ?? 0,
      descripcion: cuenta.descripcion || '',
      activo: cuenta.activo !== false,
    })

    setModalCuenta(true)
  }

  const cerrarModalCuenta = () => {
    if (guardandoCuenta) return

    setModalCuenta(false)
    setEditandoCuenta(null)
    setFormCuenta(cuentaInicial)
  }

  const guardarCuenta = async (e) => {
    e.preventDefault()

    if (!formCuenta.nombre.trim()) {
      alert('Escribe el nombre de la cuenta.')
      return
    }

    try {
      setGuardandoCuenta(true)

      const body = {
        ...formCuenta,
        negocio_id: negocioId,
        nombre: formCuenta.nombre.trim(),
        saldo_inicial:
          Number(formCuenta.saldo_inicial) || 0,
      }

      // FIX: la cuenta que se está editando viene del backend con
      // el campo "id" (no "_id" — ese se elimina en serializar()).
      if (editandoCuenta?.id) {
        await api.put(
          `/api/finanzas/cuentas/${editandoCuenta.id}`,
          body
        )
      } else {
        await api.post(
          '/api/finanzas/cuentas',
          body
        )
      }

      cerrarModalCuenta()
      await cargarDatos()
    } catch (error) {
      console.error('Error guardando cuenta:', error)

      alert(
        error.response?.data?.detail ||
          'No se pudo guardar la cuenta.'
      )
    } finally {
      setGuardandoCuenta(false)
    }
  }

  const cambiarEstadoCuenta = async (cuenta) => {
    const activar = cuenta.activo === false

    const confirmar = window.confirm(
      activar
        ? `¿Activar la cuenta "${cuenta.nombre}"?`
        : `¿Desactivar la cuenta "${cuenta.nombre}"?`
    )

    if (!confirmar) return

    try {
      // Desactivar usa DELETE (baja lógica); activar usa PUT con activo: true
      if (activar) {
        await api.put(`/api/finanzas/cuentas/${cuenta.id}`, { activo: true })
      } else {
        await api.delete(`/api/finanzas/cuentas/${cuenta.id}`)
      }

      await cargarDatos()
    } catch (error) {
      console.error('Error cambiando estado:', error)

      alert(
        error.response?.data?.detail ||
          'No se pudo cambiar el estado de la cuenta.'
      )
    }
  }

  // ============================================================
  // MOVIMIENTOS
  // ============================================================

  const abrirNuevoMovimiento = () => {
    const primeraCuenta =
      cuentas.find((cuenta) => cuenta.activo !== false)
  
    // FIX: primeraCuenta.id, no primeraCuenta._id
    // (antes esto siempre quedaba undefined -> el <select> nunca
    // preseleccionaba una cuenta válida)
    setEditandoMovimiento(null)
    setFormMovimiento({
      ...movimientoInicial,
      cuenta_id: primeraCuenta?.id || '',
    })


    setModalMovimiento(true)
  }

  const abrirEditarMovimiento = (movimiento) => {
    setEditandoMovimiento(movimiento)
    setFormMovimiento({
      tipo: movimiento.tipo,
      cuenta_id: movimiento.cuenta_id || '',
      categoria: movimiento.categoria || 'otro',
      importe: movimiento.importe ?? '',
      fecha: movimiento.fecha
        ? String(movimiento.fecha).slice(0, 10)
        : movimientoInicial.fecha,
      concepto: movimiento.concepto || '',
    })

    setModalMovimiento(true)
  }

  const eliminarMovimiento = async (movimiento) => {
    const confirmar = window.confirm(
      `¿Eliminar el movimiento "${movimiento.concepto}" por ${dinero(movimiento.importe)}? Esto cambia el saldo de la cuenta.`
    )

    if (!confirmar) return

    try {
      await api.delete(`/api/finanzas/movimientos/${movimiento.id}`)
      await cargarDatos()
    } catch (error) {
      console.error('Error eliminando movimiento:', error)

      alert(
        error.response?.data?.detail ||
          'No se pudo eliminar el movimiento.'
      )
    }
  }

  const cerrarModalMovimiento = () => {
    if (guardandoMovimiento) return

    setModalMovimiento(false)
    setEditandoMovimiento(null)
    setFormMovimiento(movimientoInicial)
  }

  const cambiarTipoMovimiento = (tipo) => {
    setFormMovimiento((actual) => ({
      ...actual,
      tipo,
      categoria:
        tipo === 'ingreso'
          ? 'venta'
          : 'gasto',
    }))
  }

  const guardarMovimiento = async (e) => {
    e.preventDefault()

    if (!formMovimiento.cuenta_id) {
      alert('Selecciona una cuenta financiera.')
      return
    }

    if (!formMovimiento.importe) {
      alert('Escribe el importe.')
      return
    }

    if (Number(formMovimiento.importe) <= 0) {
      alert('El importe debe ser mayor que cero.')
      return
    }

    if (!formMovimiento.concepto.trim()) {
      alert('Escribe el concepto del movimiento.')
      return
    }

    try {
      setGuardandoMovimiento(true)

      const body = {
        negocio_id: negocioId,
        tipo: formMovimiento.tipo,
        cuenta_id: formMovimiento.cuenta_id,
        categoria: formMovimiento.categoria,
        importe: Number(formMovimiento.importe),
        concepto: formMovimiento.concepto.trim(),
        fecha: formMovimiento.fecha
          ? new Date(
              `${formMovimiento.fecha}T12:00:00`
            ).toISOString()
          : new Date().toISOString(),
      }

      if (editandoMovimiento?.id) {
        await api.put(
          `/api/finanzas/movimientos/${editandoMovimiento.id}`,
          body
        )
      } else {
        await api.post(
          '/api/finanzas/movimientos',
          body
        )
      }

      cerrarModalMovimiento()
      await cargarDatos()
    } catch (error) {
      console.error(
        'Error guardando movimiento:',
        error
      )

      alert(
        error.response?.data?.detail ||
          'No se pudo guardar el movimiento.'
      )
    } finally {
      setGuardandoMovimiento(false)
    }
  }
  const abrirNuevoCobro = () => {
    const primeraCuenta =
      cuentas.find((cuenta) => cuenta.activo !== false)

    setFormCobro({
      ...cobroInicial,
      cuenta_id: primeraCuenta?.id || '',
    })

    setModalCobro(true)
  }

  const cerrarModalCobro = () => {
    if (guardandoCobro) return

    setModalCobro(false)
    setFormCobro(cobroInicial)
  }

  const guardarCobro = async (e) => {
    e.preventDefault()

    if (!formCobro.cuenta_id) {
      alert('Selecciona una cuenta financiera.')
      return
    }

    if (!formCobro.importe) {
      alert('Escribe el importe del cobro.')
      return
    }

    if (Number(formCobro.importe) <= 0) {
      alert('El importe debe ser mayor que cero.')
      return
    }

    try {
      setGuardandoCobro(true)

      const body = {
        negocio_id: negocioId,
        cuenta_id: formCobro.cuenta_id,
        importe: Number(formCobro.importe),
        pedido_id:
          formCobro.pedido_id.trim(),
        cliente_id:
          formCobro.cliente_id.trim(),
        metodo_pago: formCobro.metodo_pago,
        referencia:
          formCobro.referencia.trim(),
        concepto:
          formCobro.concepto.trim(),
        fecha: formCobro.fecha
          ? new Date(
              `${formCobro.fecha}T12:00:00`
            ).toISOString()
          : new Date().toISOString(),
      }

      const response = await api.post(
        '/api/finanzas/cobros',
        body
      )

      console.log(
        'Cobro creado:',
        response.data
      )

      cerrarModalCobro()
      await cargarDatos()

      alert(
        `Cobro registrado correctamente${
          response.data?.numero
            ? `: ${response.data.numero}`
            : ''
        }`
      )
    } catch (error) {
      console.error(
        'Error guardando cobro:',
        error
      )

      alert(
        error.response?.data?.detail ||
          'No se pudo registrar el cobro.'
      )
    } finally {
      setGuardandoCobro(false)
    }
  }

  const cuentaNombre = (cuentaId) => {
    // Egresos de compras pendientes de pago no tienen cuenta todavía
    if (!cuentaId) return 'Sin cuenta (pendiente de pago)'
    // FIX: comparar contra item.id, no item._id
    const cuenta = cuentas.find(
      (item) => item.id === cuentaId
    )

    return cuenta?.nombre || 'Cuenta desconocida'
  }

  const categoriaNombre = (
    tipo,
    categoria
  ) => {
    const lista =
      tipo === 'ingreso'
        ? CATEGORIAS_INGRESO
        : CATEGORIAS_EGRESO

    return (
      lista.find(
        (item) => item.value === categoria
      )?.label || categoria || 'Otro'
    )
  }

  const activos = cuentas.filter(
    (cuenta) => cuenta.activo !== false
  )

  const totalDisponible =
    dashboard?.total_dinero ??
    dashboard?.total_disponible ??
    0

  const totalIngresos = movimientos
    .filter((mov) => mov.tipo === 'ingreso')
    .reduce(
      (total, mov) =>
        total + Number(mov.importe || 0),
      0
    )

  const totalEgresos = movimientos
    .filter((mov) => mov.tipo === 'egreso')
    .reduce(
      (total, mov) =>
        total + Number(mov.importe || 0),
      0
    )

  return (
    <div>

      {/* ======================================================
          ENCABEZADO
      ====================================================== */}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          gap: '15px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>
            Finanzas
          </h1>

          <p
            style={{
              marginTop: '6px',
              color: '#666',
            }}
          >
            Finanzas operativas
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <select
            aria-label="Seleccionar empresa"
            value={negocioId}
            onChange={(e) => setNegocioId(e.target.value)}
            style={{
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              background: '#fff',
              maxWidth: '280px',
            }}
          >
            {negociosDisponibles.map((negocio) => (
              <option key={negocio.id} value={negocio.id}>
                {negocio.nombre}
              </option>
            ))}
          </select>

          <button
            onClick={abrirNuevaCuenta}
          >
            + Nueva cuenta
          </button>

            <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={abrirNuevoMovimiento}
              disabled={activos.length === 0}
            >
              + Nuevo movimiento
            </button>

            <button
              onClick={abrirNuevoCobro}
              disabled={activos.length === 0}
            >
              + Nuevo cobro
            </button>
          </div>

          
        </div>
      </div>

      {cargando ? (
        <div>
          Cargando información financiera...
        </div>
      ) : (
        <>
          {/* ==================================================
              RESUMEN
          ================================================== */}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
              marginBottom: '30px',
            }}
          >
            <div className="card">
              <strong>
                Dinero disponible
              </strong>

              <h2>
                {dinero(totalDisponible)}
              </h2>
            </div>

            <div className="card">
              <strong>
                Ingresos registrados
              </strong>

              <h2>
                {dinero(totalIngresos)}
              </h2>
            </div>

            <div className="card">
              <strong>
                Egresos registrados
              </strong>

              <h2>
                {dinero(totalEgresos)}
              </h2>
            </div>
          </div>

          {/* ==================================================
              CUENTAS
          ================================================== */}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
            }}
          >
            <h2 style={{ margin: 0 }}>
              Cuentas financieras
            </h2>

            <span>
              {cuentas.length}{' '}
              {cuentas.length === 1
                ? 'cuenta'
                : 'cuentas'}
            </span>
          </div>

          {cuentas.length === 0 ? (
            <div
              style={{
                padding: '30px',
                border: '1px solid #ddd',
                borderRadius: '10px',
                textAlign: 'center',
                marginBottom: '30px',
              }}
            >
              <h3>
                No hay cuentas financieras
              </h3>

              <p>
                Crea tu primera cuenta para
                comenzar a controlar el dinero
                del negocio.
              </p>

              <button
                onClick={abrirNuevaCuenta}
              >
                + Crear cuenta
              </button>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
                marginBottom: '35px',
              }}
            >
              {cuentas.map((cuenta) => {
                // FIX: comparar contra cuenta.id, no cuenta._id
                const resumen =
                  dashboard?.cuentas?.find(
                    (item) =>
                      item.id === cuenta.id
                  )

                const saldo =
                  resumen?.saldo ??
                  Number(cuenta.saldo_inicial || 0)

                return (
                  <div
                    key={cuenta.id}
                    style={{
                      border:
                        '1px solid #ddd',
                      borderRadius: '12px',
                      padding: '18px',
                      opacity:
                        cuenta.activo === false
                          ? 0.55
                          : 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          'space-between',
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin: 0,
                          }}
                        >
                          {cuenta.nombre}
                        </h3>

                        <div
                          style={{
                            marginTop: '5px',
                            color: '#666',
                          }}
                        >
                          {TIPOS_CUENTA.find(
                            (tipo) =>
                              tipo.value ===
                              cuenta.tipo
                          )?.label ||
                            cuenta.tipo}
                        </div>
                      </div>

                      <span>
                        {cuenta.activo === false
                          ? 'Inactiva'
                          : 'Activa'}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: '20px',
                      }}
                    >
                      <small>
                        Saldo actual
                      </small>

                      <div
                        style={{
                          fontSize: '22px',
                          fontWeight: 'bold',
                          marginTop: '4px',
                        }}
                      >
                        {dinero(
                          saldo,
                          cuenta.moneda ||
                            'MXN'
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: '8px',
                        color: '#777',
                      }}
                    >
                      Saldo inicial:{' '}
                      {dinero(
                        cuenta.saldo_inicial,
                        cuenta.moneda ||
                          'MXN'
                      )}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        marginTop: '18px',
                      }}
                    >
                      <button
                        onClick={() =>
                          abrirEditarCuenta(
                            cuenta
                          )
                        }
                      >
                        Editar
                      </button>

                      <button
                        onClick={() =>
                          cambiarEstadoCuenta(
                            cuenta
                          )
                        }
                      >
                        {cuenta.activo === false
                          ? 'Activar'
                          : 'Desactivar'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ==================================================
              MOVIMIENTOS
          ================================================== */}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px',
              gap: '10px',
            }}
          >
            <div>
              <h2 style={{ margin: 0 }}>
                Movimientos financieros
              </h2>

              <p
                style={{
                  color: '#666',
                  marginTop: '5px',
                }}
              >
                Entradas y salidas de dinero
              </p>
            </div>

            <button
              onClick={abrirNuevoMovimiento}
              disabled={activos.length === 0}
            >
              + Nuevo movimiento
            </button>
          </div>

          {movimientos.length === 0 ? (
            <div
              style={{
                border: '1px solid #ddd',
                borderRadius: '10px',
                padding: '30px',
                textAlign: 'center',
              }}
            >
              <h3>
                No hay movimientos
              </h3>

              <p>
                Registra el primer ingreso o
                egreso de tu negocio.
              </p>

              <button
                onClick={abrirNuevoMovimiento}
                disabled={activos.length === 0}
              >
                + Registrar movimiento
              </button>
            </div>
          ) : (
            <div
              style={{
                overflowX: 'auto',
                border:
                  '1px solid #ddd',
                borderRadius: '10px',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse:
                    'collapse',
                  minWidth: '800px',
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Fecha
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Tipo
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Concepto
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Categoría
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'left',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Cuenta
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Importe
                    </th>

                    <th
                      style={{
                        padding: '12px',
                        textAlign: 'right',
                        borderBottom:
                          '1px solid #ddd',
                      }}
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {movimientos.map(
                    (movimiento) => (
                      <tr
                        key={
                          movimiento.id
                        }
                        id={`mov-${movimiento.id}`}
                        title={
                          movimiento.estado === 'cancelado' || movimiento.estado === 'anulado'
                            ? 'Movimiento cancelado: no suma al saldo'
                            : undefined
                        }
                        style={
                          movimiento.estado === 'cancelado' || movimiento.estado === 'anulado'
                            ? { opacity: 0.45, textDecoration: 'line-through' }
                            : movimiento.id === refMovimiento
                              ? { background: '#fef9c3', outline: '2px solid #facc15' }
                              : undefined
                        }
                      >
                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                          }}
                        >
                          {formatearFecha(
                            movimiento.fecha
                          )}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                          }}
                        >
                          <span>
                            {movimiento.tipo ===
                            'ingreso'
                              ? 'Ingreso'
                              : 'Egreso'}
                          </span>
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                          }}
                        >
                          {movimiento.concepto ||
                            '--'}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                          }}
                        >
                          {categoriaNombre(
                            movimiento.tipo,
                            movimiento.categoria
                          )}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                          }}
                        >
                          {cuentaNombre(
                            movimiento.cuenta_id
                          )}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                            textAlign: 'right',
                            fontWeight: 'bold',
                          }}
                        >
                          {movimiento.tipo ===
                          'ingreso'
                            ? '+'
                            : '-'}{' '}
                          {dinero(
                            movimiento.importe
                          )}
                        </td>

                        <td
                          style={{
                            padding: '12px',
                            borderBottom:
                              '1px solid #eee',
                            textAlign: 'right',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {movimiento.referencia_tipo ? (
                            <span
                              title="Viene de un cobro: anula el cobro para cambiarlo"
                              style={{ color: '#888', fontSize: '0.85em' }}
                            >
                              Cobro
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => abrirEditarMovimiento(movimiento)}
                              >
                                Editar
                              </button>{' '}
                              <button
                                type="button"
                                onClick={() => eliminarMovimiento(movimiento)}
                              >
                                Eliminar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ======================================================
          MODAL CUENTA
      ====================================================== */}

      {modalCuenta && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={guardarCuenta}
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '520px',
            }}
          >
            <h2>
              {editandoCuenta
                ? 'Editar cuenta'
                : 'Nueva cuenta'}
            </h2>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Nombre
              </label>

              <input
                type="text"
                value={formCuenta.nombre}
                onChange={(e) =>
                  setFormCuenta({
                    ...formCuenta,
                    nombre: e.target.value,
                  })
                }
                placeholder="Ej. BBVA Empresarial"
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Tipo
              </label>

              <select
                value={formCuenta.tipo}
                onChange={(e) =>
                  setFormCuenta({
                    ...formCuenta,
                    tipo: e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              >
                {TIPOS_CUENTA.map(
                  (tipo) => (
                    <option
                      key={
                        tipo.value
                      }
                      value={
                        tipo.value
                      }
                    >
                      {tipo.label}
                    </option>
                  )
                )}
              </select>
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Moneda
              </label>

              <select
                value={formCuenta.moneda}
                onChange={(e) =>
                  setFormCuenta({
                    ...formCuenta,
                    moneda:
                      e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              >
                {MONEDAS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              {formCuenta.moneda !== 'MXN' && (
                <p style={{fontSize:'.8rem', color:'var(--color-warning, #92400E)', marginTop:4}}>
                  💱 Tipo de cambio no incluido — el monto se registra en {formCuenta.moneda} tal como
                  se capture. Verifica la paridad al emitir la factura (SAT requiere tipo de cambio
                  en CFDI con moneda extranjera).
                </p>
              )}
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Saldo inicial
              </label>

              <input
                type="number"
                step="0.01"
                value={
                  formCuenta.saldo_inicial
                }
                onChange={(e) =>
                  setFormCuenta({
                    ...formCuenta,
                    saldo_inicial:
                      e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                marginBottom: '20px',
              }}
            >
              <label>
                Descripción
              </label>

              <textarea
                value={
                  formCuenta.descripcion
                }
                onChange={(e) =>
                  setFormCuenta({
                    ...formCuenta,
                    descripcion:
                      e.target.value,
                  })
                }
                rows="3"
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={
                  cerrarModalCuenta
                }
                disabled={
                  guardandoCuenta
                }
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={
                  guardandoCuenta
                }
              >
                {guardandoCuenta
                  ? 'Guardando...'
                  : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======================================================
          MODAL MOVIMIENTO
      ====================================================== */}

      {modalMovimiento && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <form
            onSubmit={
              guardarMovimiento
            }
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '520px',
            }}
          >
            <h2>
              {editandoMovimiento ? 'Editar movimiento' : 'Nuevo movimiento'}
            </h2>

            <div
              style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '18px',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  cambiarTipoMovimiento(
                    'ingreso'
                  )
                }
              >
                {formMovimiento.tipo ===
                'ingreso'
                  ? '✓ '
                  : ''}
                Ingreso
              </button>

              <button
                type="button"
                onClick={() =>
                  cambiarTipoMovimiento(
                    'egreso'
                  )
                }
              >
                {formMovimiento.tipo ===
                'egreso'
                  ? '✓ '
                  : ''}
                Egreso
              </button>
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Cuenta
              </label>

              <select
                value={
                  formMovimiento.cuenta_id
                }
                onChange={(e) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    cuenta_id:
                      e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              >
                <option value="">
                  Selecciona una cuenta
                </option>

                {activos.map(
                  (cuenta) => (
                    // FIX: key/value con cuenta.id, no cuenta._id
                    <option
                      key={
                        cuenta.id
                      }
                      value={
                        cuenta.id
                      }
                    >
                      {cuenta.nombre}
                    </option>
                  )
                )}
              </select>
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Categoría
              </label>

              <select
                value={
                  formMovimiento.categoria
                }
                onChange={(e) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    categoria:
                      e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              >
                {(formMovimiento.tipo ===
                'ingreso'
                  ? CATEGORIAS_INGRESO
                  : CATEGORIAS_EGRESO
                ).map(
                  (categoria) => (
                    <option
                      key={
                        categoria.value
                      }
                      value={
                        categoria.value
                      }
                    >
                      {
                        categoria.label
                      }
                    </option>
                  )
                )}
              </select>
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Importe
              </label>

              <input
                type="number"
                min="0.01"
                step="0.01"
                value={
                  formMovimiento.importe
                }
                onChange={(e) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    importe:
                      e.target.value,
                  })
                }
                placeholder="0.00"
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                marginBottom: '14px',
              }}
            >
              <label>
                Fecha
              </label>

              <input
                type="date"
                value={
                  formMovimiento.fecha
                }
                onChange={(e) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    fecha:
                      e.target.value,
                  })
                }
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                marginBottom: '20px',
              }}
            >
              <label>
                Concepto
              </label>

              <input
                type="text"
                value={
                  formMovimiento.concepto
                }
                onChange={(e) =>
                  setFormMovimiento({
                    ...formMovimiento,
                    concepto:
                      e.target.value,
                  })
                }
                placeholder="Ej. Venta de producto"
                style={{
                  width: '100%',
                  padding: '10px',
                  marginTop: '5px',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent:
                  'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={
                  cerrarModalMovimiento
                }
                disabled={
                  guardandoMovimiento
                }
              >
                Cancelar
              </button>

              <button
                type="submit"
                disabled={
                  guardandoMovimiento
                }
              >
                {guardandoMovimiento
                  ? 'Guardando...'
                  : 'Guardar movimiento'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ======================================================
          MODAL COBRO
        ====================================================== */}

        {modalCobro && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              zIndex: 1000,
            }}
          >
            <form
              onSubmit={guardarCobro}
              style={{
                background: '#fff',
                padding: '24px',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '520px',
                maxHeight: '90vh',
                overflowY: 'auto',
              }}
            >
              <h2>Nuevo cobro</h2>

              <div style={{ marginBottom: '14px' }}>
                <label>Cuenta financiera</label>

                <select
                  value={formCobro.cuenta_id}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      cuenta_id: e.target.value,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                >
                  <option value="">
                    Selecciona una cuenta
                  </option>

                  {activos.map((cuenta) => (
                    <option
                      key={cuenta.id}
                      value={cuenta.id}
                    >
                      {cuenta.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>Importe</label>

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={formCobro.importe}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      importe: e.target.value,
                    })
                  }
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>Método de pago</label>

                <select
                  value={formCobro.metodo_pago}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      metodo_pago: e.target.value,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="deposito">Depósito</option>
                  <option value="otro">Otro</option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>Fecha</label>

                <input
                  type="date"
                  value={formCobro.fecha}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      fecha: e.target.value,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>ID del pedido (opcional)</label>

                <input
                  type="text"
                  value={formCobro.pedido_id}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      pedido_id: e.target.value,
                    })
                  }
                  placeholder="ID del pedido"
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>ID del cliente (opcional)</label>

                <input
                  type="text"
                  value={formCobro.cliente_id}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      cliente_id: e.target.value,
                    })
                  }
                  placeholder="ID del cliente"
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label>Referencia (opcional)</label>

                <input
                  type="text"
                  value={formCobro.referencia}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      referencia: e.target.value,
                    })
                  }
                  placeholder="Folio, transferencia, etc."
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label>Concepto</label>

                <input
                  type="text"
                  value={formCobro.concepto}
                  onChange={(e) =>
                    setFormCobro({
                      ...formCobro,
                      concepto: e.target.value,
                    })
                  }
                  placeholder="Ej. Cobro de pedido"
                  style={{
                    width: '100%',
                    padding: '10px',
                    marginTop: '5px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '10px',
                }}
              >
                <button
                  type="button"
                  onClick={cerrarModalCobro}
                  disabled={guardandoCobro}
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={guardandoCobro}
                >
                  {guardandoCobro
                    ? 'Registrando...'
                    : 'Registrar cobro'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
  )
}