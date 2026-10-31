import { useEffect, useState } from 'react'
import { useNegocio } from '../context/NegocioContext'

function periodoActual() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function dinero(valor) {
  return Number(valor || 0).toLocaleString('es-MX', {
    style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
  })
}

function fecha(v) {
  if (!v) return '--'
  try { return new Date(v).toLocaleDateString('es-MX') } catch { return v }
}

const TIPOS_POLIZA = [
  { value: 'diario',    label: 'Diario'    },
  { value: 'ingreso',   label: 'Ingreso'   },
  { value: 'egreso',    label: 'Egreso'    },
  { value: 'traspaso',  label: 'Traspaso'  },
  { value: 'ajuste',    label: 'Ajuste'    },
]

const TIPOS_CUENTA = [
  { value: 'activo',   label: 'Activo'   },
  { value: 'pasivo',   label: 'Pasivo'   },
  { value: 'capital',  label: 'Capital'  },
  { value: 'ingreso',  label: 'Ingreso'  },
  { value: 'costo',    label: 'Costo'    },
  { value: 'gasto',    label: 'Gasto'    },
]

const estadoPolizaColor = {
  borrador:       { color: '#d97706', bg: '#fffbeb' },
  contabilizada:  { color: '#16a34a', bg: '#f0fdf4' },
  cancelada:      { color: '#dc2626', bg: '#fef2f2' },
}

export default function Contabilidad() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  const [periodo, setPeriodo] = useState(periodoActual)
  const [vista, setVista] = useState('balance')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Reportes
  const [balance, setBalance]       = useState(null)
  const [balanza, setBalanza]       = useState(null)
  const [ventasPeriodo, setVentasPeriodo] = useState(null)
  const [resultados, setResultados] = useState(null)

  // Pólizas
  const [polizas, setPolizas]                   = useState([])
  const [polizaSeleccionada, setPolizaSeleccionada] = useState(null)
  const [movsPoliza, setMovsPoliza]             = useState([])
  const [modalPoliza, setModalPoliza]           = useState(false) // nueva póliza
  const [modalDetalle, setModalDetalle]         = useState(false)
  const [formPoliza, setFormPoliza]             = useState({ tipo: 'diario', concepto: '', fecha: new Date().toISOString().slice(0, 10) })
  const [formMovimiento, setFormMovimiento]     = useState({ cuenta_id: '', concepto: '', lado: 'debe', monto: '' })
  const [guardandoPoliza, setGuardandoPoliza]   = useState(false)
  const [guardandoMov, setGuardandoMov]         = useState(false)

  // Cuentas contables
  const [cuentas, setCuentas]           = useState([])
  const [modalCuenta, setModalCuenta]   = useState(false)
  const [editandoCuenta, setEditandoCuenta] = useState(null)
  const [formCuenta, setFormCuenta]     = useState({ codigo: '', nombre: '', tipo: 'activo', naturaleza: 'deudora' })
  const [guardandoCuenta, setGuardandoCuenta] = useState(false)

  // Períodos
  const [periodos, setPeriodos]         = useState([])
  const [modalPeriodo, setModalPeriodo] = useState(false)
  const [formPeriodo, setFormPeriodo]   = useState({ periodo: periodoActual() })
  const [guardandoPeriodo, setGuardandoPeriodo] = useState(false)

  // ── API helper ────────────────────────────────────────────

  async function req(url, opts = {}) {
    const token = localStorage.getItem('token')
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.detail ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)) : 'Error en la solicitud')
    return data
  }

  // ── Carga reportes ────────────────────────────────────────

  async function cargarReportes() {
    setCargando(true); setError('')
    try {
      const q = `negocio_id=${encodeURIComponent(negocioId)}&periodo=${encodeURIComponent(periodo)}`
      const [b, ba, r, v] = await Promise.all([
        req(`/api/contabilidad/reportes/balance-general?${q}`),
        req(`/api/contabilidad/reportes/balanza-comprobacion?${q}`),
        req(`/api/contabilidad/reportes/estado-resultados?${q}`),
        req(`/api/contabilidad/reportes/ventas-periodo?${q}`),
      ])
      setBalance(b); setBalanza(ba); setResultados(r); setVentasPeriodo(v)
    } catch (err) { setError(err.message || 'Error al cargar contabilidad') }
    finally { setCargando(false) }
  }

  // ── Carga pólizas ─────────────────────────────────────────

  async function cargarPolizas() {
    try {
      const data = await req(`/api/contabilidad/polizas?negocio_id=${encodeURIComponent(negocioId)}&periodo=${encodeURIComponent(periodo)}`)
      setPolizas(Array.isArray(data) ? data : data.data || [])
    } catch (err) { setError(err.message) }
  }

  async function cargarDetalle(poliza) {
    try {
      const pol = await req(`/api/contabilidad/polizas/${poliza.id || poliza._id}`)
      const id = pol.id || pol._id
      setPolizaSeleccionada({ ...pol, id })
      setMovsPoliza(Array.isArray(pol.movimientos) ? pol.movimientos : [])
      setFormMovimiento({ cuenta_id: '', concepto: '', lado: 'debe', monto: '' })
      setModalDetalle(true)
    } catch (err) { setError(err.message) }
  }

  async function crearPoliza(e) {
    e.preventDefault()
    if (!formPoliza.concepto.trim()) { setError('El concepto es requerido.'); return }
    setGuardandoPoliza(true); setError('')
    try {
      await req('/api/contabilidad/polizas', {
        method: 'POST',
        body: JSON.stringify({
          negocio_id: negocioId,
          tipo: formPoliza.tipo,
          concepto: formPoliza.concepto.trim(),
          fecha: formPoliza.fecha,
          periodo,
        }),
      })
      setModalPoliza(false)
      await cargarPolizas()
    } catch (err) { setError(err.message) }
    finally { setGuardandoPoliza(false) }
  }

  async function agregarMovimiento(e) {
    e.preventDefault()
    if (!formMovimiento.cuenta_id) { setError('Selecciona una cuenta.'); return }
    if (!formMovimiento.monto || Number(formMovimiento.monto) <= 0) { setError('Ingresa un monto válido.'); return }
    setGuardandoMov(true); setError('')
    try {
      const id = polizaSeleccionada.id || polizaSeleccionada._id
      const monto = Number(formMovimiento.monto)
      await req(`/api/contabilidad/polizas/${id}/movimientos`, {
        method: 'POST',
        body: JSON.stringify({
          cuenta_id: formMovimiento.cuenta_id,
          concepto: formMovimiento.concepto.trim(),
          debe:  formMovimiento.lado === 'debe'  ? monto : 0,
          haber: formMovimiento.lado === 'haber' ? monto : 0,
        }),
      })
      await cargarDetalle(polizaSeleccionada)
    } catch (err) { setError(err.message) }
    finally { setGuardandoMov(false) }
  }

  async function eliminarMovimiento(movId) {
    if (!window.confirm('¿Eliminar este movimiento?')) return
    try {
      const id = polizaSeleccionada.id || polizaSeleccionada._id
      await req(`/api/contabilidad/polizas/${id}/movimientos/${movId}`, { method: 'DELETE' })
      await cargarDetalle(polizaSeleccionada)
    } catch (err) { setError(err.message) }
  }

  async function contabilizar() {
    if (!window.confirm('¿Contabilizar esta póliza? Esta acción no se puede deshacer.')) return
    try {
      const id = polizaSeleccionada.id || polizaSeleccionada._id
      await req(`/api/contabilidad/polizas/${id}/contabilizar`, { method: 'PATCH' })
      await cargarDetalle(polizaSeleccionada)
      await cargarPolizas()
    } catch (err) { setError(err.message) }
  }

  async function cancelarPoliza() {
    if (!window.confirm('¿Cancelar esta póliza?')) return
    try {
      const id = polizaSeleccionada.id || polizaSeleccionada._id
      await req(`/api/contabilidad/polizas/${id}/cancelar`, { method: 'PATCH' })
      await cargarDetalle(polizaSeleccionada)
      await cargarPolizas()
    } catch (err) { setError(err.message) }
  }

  // ── Cuentas contables ─────────────────────────────────────

  async function cargarCuentas() {
    try {
      const data = await req(`/api/contabilidad/cuentas?negocio_id=${encodeURIComponent(negocioId)}`)
      setCuentas(Array.isArray(data) ? data : data.data || [])
    } catch (err) { setError(err.message) }
  }

  async function guardarCuenta(e) {
    e.preventDefault()
    if (!formCuenta.codigo.trim() || !formCuenta.nombre.trim()) { setError('Código y nombre son requeridos.'); return }
    setGuardandoCuenta(true); setError('')
    try {
      if (editandoCuenta) {
        const id = editandoCuenta.id || editandoCuenta._id
        await req(`/api/contabilidad/cuentas/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...formCuenta, negocio_id: negocioId }),
        })
      } else {
        await req('/api/contabilidad/cuentas', {
          method: 'POST',
          body: JSON.stringify({ ...formCuenta, negocio_id: negocioId, codigo: formCuenta.codigo.trim(), nombre: formCuenta.nombre.trim() }),
        })
      }
      setModalCuenta(false); setEditandoCuenta(null)
      await cargarCuentas()
    } catch (err) { setError(err.message) }
    finally { setGuardandoCuenta(false) }
  }

  async function toggleCuenta(cuenta) {
    const id = cuenta.id || cuenta._id
    const accion = cuenta.activo === false ? 'activar' : 'desactivar'
    if (!window.confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} la cuenta "${cuenta.nombre}"?`)) return
    try {
      await req(`/api/contabilidad/cuentas/${id}`, { method: 'DELETE' })
      await cargarCuentas()
    } catch (err) { setError(err.message) }
  }

  function abrirEditarCuenta(cuenta) {
    setEditandoCuenta(cuenta)
    setFormCuenta({ codigo: cuenta.codigo || '', nombre: cuenta.nombre || '', tipo: cuenta.tipo || 'activo', naturaleza: cuenta.naturaleza || 'deudora' })
    setModalCuenta(true)
  }

  function abrirNuevaCuenta() {
    setEditandoCuenta(null)
    setFormCuenta({ codigo: '', nombre: '', tipo: 'activo', naturaleza: 'deudora' })
    setModalCuenta(true)
  }

  // ── Períodos ──────────────────────────────────────────────

  async function cargarPeriodos() {
    try {
      const data = await req(`/api/contabilidad/periodos?negocio_id=${encodeURIComponent(negocioId)}`)
      setPeriodos(Array.isArray(data) ? data : [])
    } catch (err) { setError(err.message) }
  }

  async function crearPeriodo(e) {
    e.preventDefault()
    if (!formPeriodo.periodo) { setError('El período es requerido.'); return }
    setGuardandoPeriodo(true); setError('')
    try {
      await req('/api/contabilidad/periodos', {
        method: 'POST',
        body: JSON.stringify({ negocio_id: negocioId, periodo: formPeriodo.periodo }),
      })
      setModalPeriodo(false)
      await cargarPeriodos()
    } catch (err) { setError(err.message) }
    finally { setGuardandoPeriodo(false) }
  }

  async function cambiarEstadoPeriodo(p, nuevoEstado) {
    const accion = nuevoEstado === 'cerrado' ? 'cerrar' : 'abrir'
    if (!window.confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} el período ${p.periodo}?`)) return
    try {
      const id = p.id || p._id
      await req(`/api/contabilidad/periodos/${id}/estado?negocio_id=${encodeURIComponent(negocioId)}&estado=${nuevoEstado}`, { method: 'PATCH' })
      await cargarPeriodos()
    } catch (err) { setError(err.message) }
  }

  // ── Efectos ───────────────────────────────────────────────

  useEffect(() => {
    if (['balance', 'resultados', 'balanza'].includes(vista)) cargarReportes()
    if (vista === 'polizas') { cargarPolizas(); cargarCuentas() }
    if (vista === 'cuentas') cargarCuentas()
    if (vista === 'periodos') cargarPeriodos()
  }, [negocioId, periodo, vista])

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>

      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, color: '#0f172a' }}>Contabilidad</h1>
          <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 14 }}>Estados financieros y control contable</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} style={sel}>
            {negociosDisponibles.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={sel} />
          <button onClick={() => {
            if (['balance','resultados','balanza'].includes(vista)) cargarReportes()
            if (vista === 'polizas') cargarPolizas()
            if (vista === 'cuentas') cargarCuentas()
            if (vista === 'periodos') cargarPeriodos()
          }} disabled={cargando} style={btnPrimary}>
            {cargando ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 14, marginBottom: 20, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 14, display: 'flex', justifyContent: 'space-between' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ border: 'none', background: 'transparent', color: '#991b1b', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #e2e8f0', marginBottom: 24, flexWrap: 'wrap' }}>
        {[
          { key: 'balance',    label: 'Balance General'       },
          { key: 'resultados', label: 'Estado de Resultados'  },
          { key: 'balanza',    label: 'Balanza'               },
          { key: 'polizas',    label: 'Pólizas'               },
          { key: 'cuentas',    label: 'Cuentas'               },
          { key: 'periodos',   label: 'Períodos'              },
        ].map(({ key, label }) => (
          <Tab key={key} activo={vista === key} onClick={() => setVista(key)}>{label}</Tab>
        ))}
      </div>

      {vista === 'balance'    && balance    && <BalanceGeneral data={balance} ventasPeriodo={ventasPeriodo} />}
      {vista === 'resultados' && resultados && <EstadoResultados data={resultados} />}
      {vista === 'balanza'    && balanza    && <Balanza data={balanza} />}

      {/* ── TAB PÓLIZAS ── */}
      {vista === 'polizas' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: '#64748b', fontSize: 13 }}>{polizas.length} pólizas en {periodo}</span>
            <button onClick={() => { setFormPoliza({ tipo: 'diario', concepto: '', fecha: new Date().toISOString().slice(0, 10) }); setModalPoliza(true) }} style={btnPrimary}>
              + Nueva póliza
            </button>
          </div>

          {polizas.length === 0 ? (
            <div style={{ padding: 50, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#64748b' }}>
              No hay pólizas para este período.
              <br /><br />
              <button onClick={() => { setFormPoliza({ tipo: 'diario', concepto: '', fecha: new Date().toISOString().slice(0, 10) }); setModalPoliza(true) }} style={btnPrimary}>
                + Crear primera póliza
              </button>
            </div>
          ) : (
            <div style={card}>
              <div style={{ ...thRow, gridTemplateColumns: '1.2fr 1fr 1fr 2fr 1fr 1fr 1fr 1.2fr' }}>
                <span>Número</span><span>Tipo</span><span>Fecha</span><span>Concepto</span>
                <span style={{ textAlign: 'right' }}>Debe</span><span style={{ textAlign: 'right' }}>Haber</span>
                <span>Estado</span><span>Acciones</span>
              </div>
              {polizas.map((p) => {
                const est = estadoPolizaColor[p.estado] || {}
                return (
                  <div key={p.id || p._id} style={{ ...tdRow, gridTemplateColumns: '1.2fr 1fr 1fr 2fr 1fr 1fr 1fr 1.2fr' }}>
                    <button onClick={() => cargarDetalle(p)} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, padding: 0 }}>{p.numero}</button>
                    <span style={{ fontSize: 12 }}>{TIPOS_POLIZA.find(t => t.value === p.tipo)?.label || p.tipo}</span>
                    <span style={{ fontSize: 12 }}>{fecha(p.fecha)}</span>
                    <span>{p.concepto || '--'}</span>
                    <span style={{ textAlign: 'right', fontWeight: 600 }}>{dinero(p.total_debe)}</span>
                    <span style={{ textAlign: 'right', fontWeight: 600 }}>{dinero(p.total_haber)}</span>
                    <span style={{ ...badge, ...est }}>{p.estado}</span>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => cargarDetalle(p)} style={btnSm}>Ver</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB CUENTAS ── */}
      {vista === 'cuentas' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: '#64748b', fontSize: 13 }}>{cuentas.length} cuentas contables</span>
            <button onClick={abrirNuevaCuenta} style={btnPrimary}>+ Nueva cuenta</button>
          </div>

          {cuentas.length === 0 ? (
            <div style={{ padding: 50, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#64748b' }}>
              No hay cuentas contables. Crea el catálogo de cuentas para comenzar.
              <br /><br />
              <button onClick={abrirNuevaCuenta} style={btnPrimary}>+ Crear cuenta</button>
            </div>
          ) : (
            <div style={card}>
              <div style={{ ...thRow, gridTemplateColumns: '.8fr 2fr 1fr 1fr 1fr 1.2fr' }}>
                <span>Código</span><span>Nombre</span><span>Tipo</span><span>Naturaleza</span><span>Estado</span><span>Acciones</span>
              </div>
              {cuentas.map((c) => (
                <div key={c.id || c._id} style={{ ...tdRow, gridTemplateColumns: '.8fr 2fr 1fr 1fr 1fr 1.2fr', opacity: c.activo === false ? 0.55 : 1 }}>
                  <code style={{ fontFamily: 'monospace', fontSize: 13 }}>{c.codigo}</code>
                  <span style={{ fontWeight: 500 }}>{c.nombre}</span>
                  <span style={{ fontSize: 12 }}>{TIPOS_CUENTA.find(t => t.value === c.tipo)?.label || c.tipo}</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{c.naturaleza}</span>
                  <span style={{ ...badge, color: c.activo === false ? '#dc2626' : '#16a34a', background: c.activo === false ? '#fef2f2' : '#f0fdf4' }}>
                    {c.activo === false ? 'Inactiva' : 'Activa'}
                  </span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => abrirEditarCuenta(c)} style={btnSm}>Editar</button>
                    <button onClick={() => toggleCuenta(c)} style={{ ...btnSm, color: c.activo === false ? '#16a34a' : '#dc2626', borderColor: c.activo === false ? '#bbf7d0' : '#fecaca' }}>
                      {c.activo === false ? 'Activar' : 'Desactivar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB PERÍODOS ── */}
      {vista === 'periodos' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ color: '#64748b', fontSize: 13 }}>{periodos.length} períodos contables</span>
            <button onClick={() => { setFormPeriodo({ periodo: periodoActual() }); setModalPeriodo(true) }} style={btnPrimary}>+ Nuevo período</button>
          </div>

          {periodos.length === 0 ? (
            <div style={{ padding: 50, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, color: '#64748b' }}>
              No hay períodos. Crea el período contable para poder registrar pólizas.
              <br /><br />
              <button onClick={() => { setFormPeriodo({ periodo: periodoActual() }); setModalPeriodo(true) }} style={btnPrimary}>+ Crear período</button>
            </div>
          ) : (
            <div style={card}>
              <div style={{ ...thRow, gridTemplateColumns: '1fr 1fr 1fr 1.2fr' }}>
                <span>Período</span><span>Fecha inicio</span><span>Estado</span><span>Acciones</span>
              </div>
              {periodos.map((p) => (
                <div key={p.id || p._id} style={{ ...tdRow, gridTemplateColumns: '1fr 1fr 1fr 1.2fr' }}>
                  <strong>{p.periodo}</strong>
                  <span style={{ fontSize: 12 }}>{fecha(p.fecha_inicio) || '--'}</span>
                  <span style={{ ...badge, color: p.estado === 'abierto' ? '#16a34a' : '#dc2626', background: p.estado === 'abierto' ? '#f0fdf4' : '#fef2f2' }}>
                    {p.estado === 'abierto' ? 'Abierto' : 'Cerrado'}
                  </span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {p.estado === 'abierto'
                      ? <button onClick={() => cambiarEstadoPeriodo(p, 'cerrado')} style={{ ...btnSm, color: '#dc2626', borderColor: '#fecaca' }}>Cerrar</button>
                      : <button onClick={() => cambiarEstadoPeriodo(p, 'abierto')} style={{ ...btnSm, color: '#16a34a', borderColor: '#bbf7d0' }}>Abrir</button>
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL NUEVA PÓLIZA ── */}
      {modalPoliza && (
        <Modal titulo="Nueva póliza" cerrar={() => setModalPoliza(false)}>
          <form onSubmit={crearPoliza}>
            <Campo label="Tipo">
              <select value={formPoliza.tipo} onChange={e => setFormPoliza(p => ({ ...p, tipo: e.target.value }))} style={inp}>
                {TIPOS_POLIZA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Campo>
            <Campo label="Fecha">
              <input type="date" value={formPoliza.fecha} onChange={e => setFormPoliza(p => ({ ...p, fecha: e.target.value }))} style={inp} />
            </Campo>
            <Campo label="Concepto">
              <input type="text" value={formPoliza.concepto} onChange={e => setFormPoliza(p => ({ ...p, concepto: e.target.value }))} placeholder="Describe la póliza" style={inp} autoFocus />
            </Campo>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#64748b', marginTop: 12 }}>
              Se creará en borrador para el período <strong>{periodo}</strong>. Debe existir ese período y estar abierto.
            </div>
            <div style={modalFooter}>
              <button type="button" onClick={() => setModalPoliza(false)} style={btnSecondary}>Cancelar</button>
              <button type="submit" disabled={guardandoPoliza} style={btnPrimary}>{guardandoPoliza ? 'Creando...' : 'Crear póliza'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL DETALLE PÓLIZA ── */}
      {modalDetalle && polizaSeleccionada && (
        <Modal titulo={`Póliza ${polizaSeleccionada.numero || ''}`} cerrar={() => { setModalDetalle(false); setPolizaSeleccionada(null) }} ancho={860}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <span style={{ ...badge, ...estadoPolizaColor[polizaSeleccionada.estado] }}>{polizaSeleccionada.estado}</span>
              <span style={{ marginLeft: 10, color: '#64748b', fontSize: 13 }}>{polizaSeleccionada.concepto}</span>
              <span style={{ marginLeft: 10, color: '#94a3b8', fontSize: 12 }}>{fecha(polizaSeleccionada.fecha)}</span>
            </div>
            {polizaSeleccionada.estado === 'borrador' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={contabilizar}
                  disabled={Math.abs(Number(polizaSeleccionada.total_debe) - Number(polizaSeleccionada.total_haber)) > 0.01}
                  style={{ ...btnPrimary, background: '#16a34a', opacity: Math.abs(Number(polizaSeleccionada.total_debe) - Number(polizaSeleccionada.total_haber)) > 0.01 ? 0.5 : 1 }}
                  title="Debe y Haber deben estar balanceados"
                >
                  Contabilizar
                </button>
                <button onClick={cancelarPoliza} style={{ ...btnSm, color: '#dc2626', borderColor: '#fecaca' }}>Cancelar póliza</button>
              </div>
            )}
          </div>

          {/* Movimientos */}
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ ...thRow, gridTemplateColumns: '2fr 2fr 1.2fr 1.2fr .4fr' }}>
              <span>Cuenta</span><span>Concepto</span>
              <span style={{ textAlign: 'right' }}>Debe</span>
              <span style={{ textAlign: 'right' }}>Haber</span>
              <span></span>
            </div>
            {movsPoliza.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Sin movimientos — agrega el primer asiento.</div>
            ) : movsPoliza.map((m, i) => (
              <div key={m.id || m._id || i} style={{ ...tdRow, gridTemplateColumns: '2fr 2fr 1.2fr 1.2fr .4fr' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{m.cuenta_nombre || m.cuenta_id}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.cuenta_codigo}</div>
                </div>
                <span style={{ fontSize: 13 }}>{m.concepto || '--'}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{m.debe > 0 ? dinero(m.debe) : ''}</span>
                <span style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{m.haber > 0 ? dinero(m.haber) : ''}</span>
                <div>
                  {polizaSeleccionada.estado === 'borrador' && (
                    <button onClick={() => eliminarMovimiento(m.id || m._id)} style={{ border: 'none', background: '#fef2f2', color: '#dc2626', width: 24, height: 24, borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>×</button>
                  )}
                </div>
              </div>
            ))}
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end', gap: 30 }}>
              <span>Debe: <strong>{dinero(polizaSeleccionada.total_debe)}</strong></span>
              <span>Haber: <strong>{dinero(polizaSeleccionada.total_haber)}</strong></span>
              <span style={{ color: Math.abs(Number(polizaSeleccionada.total_debe) - Number(polizaSeleccionada.total_haber)) > 0.01 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>
                {Math.abs(Number(polizaSeleccionada.total_debe) - Number(polizaSeleccionada.total_haber)) > 0.01
                  ? `Diferencia: ${dinero(Math.abs(Number(polizaSeleccionada.total_debe) - Number(polizaSeleccionada.total_haber)))}`
                  : '✓ Balanceada'}
              </span>
            </div>
          </div>

          {/* Form agregar movimiento */}
          {polizaSeleccionada.estado === 'borrador' && (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <div style={{ fontWeight: 600, color: '#334155', marginBottom: 12, fontSize: 14 }}>Agregar movimiento</div>
              <form onSubmit={agregarMovimiento}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr .8fr 1fr auto', gap: 10, alignItems: 'end' }}>
                  <div>
                    <label style={lbl}>Cuenta contable</label>
                    <select value={formMovimiento.cuenta_id} onChange={e => setFormMovimiento(m => ({ ...m, cuenta_id: e.target.value }))} style={inp}>
                      <option value="">Selecciona cuenta</option>
                      {cuentas.filter(c => c.activo !== false).map(c => (
                        <option key={c.id || c._id} value={c.id || c._id}>{c.codigo} — {c.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Concepto</label>
                    <input value={formMovimiento.concepto} onChange={e => setFormMovimiento(m => ({ ...m, concepto: e.target.value }))} placeholder="Descripción" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Lado</label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['debe','haber'].map(l => (
                        <button key={l} type="button" onClick={() => setFormMovimiento(m => ({ ...m, lado: l }))}
                          style={{ flex: 1, padding: '8px 4px', border: `2px solid ${formMovimiento.lado === l ? '#0f172a' : '#e2e8f0'}`, borderRadius: 5, background: formMovimiento.lado === l ? '#0f172a' : '#fff', color: formMovimiento.lado === l ? '#fff' : '#475569', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                          {l.charAt(0).toUpperCase() + l.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={lbl}>Monto</label>
                    <input type="number" min="0.01" step="0.01" value={formMovimiento.monto} onChange={e => setFormMovimiento(m => ({ ...m, monto: e.target.value }))} placeholder="0.00" style={inp} />
                  </div>
                  <button type="submit" disabled={guardandoMov} style={{ ...btnPrimary, marginBottom: 1 }}>{guardandoMov ? '...' : '+ Agregar'}</button>
                </div>
              </form>
            </div>
          )}
        </Modal>
      )}

      {/* ── MODAL CUENTA CONTABLE ── */}
      {modalCuenta && (
        <Modal titulo={editandoCuenta ? `Editar: ${editandoCuenta.nombre}` : 'Nueva cuenta contable'} cerrar={() => { setModalCuenta(false); setEditandoCuenta(null) }}>
          <form onSubmit={guardarCuenta}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
              <Campo label="Código *">
                <input value={formCuenta.codigo} onChange={e => setFormCuenta(c => ({ ...c, codigo: e.target.value }))} placeholder="Ej. 1100" style={inp} autoFocus />
              </Campo>
              <Campo label="Nombre *">
                <input value={formCuenta.nombre} onChange={e => setFormCuenta(c => ({ ...c, nombre: e.target.value }))} placeholder="Ej. Caja" style={inp} />
              </Campo>
              <Campo label="Tipo">
                <select value={formCuenta.tipo} onChange={e => setFormCuenta(c => ({ ...c, tipo: e.target.value }))} style={inp}>
                  {TIPOS_CUENTA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Campo>
              <Campo label="Naturaleza">
                <select value={formCuenta.naturaleza} onChange={e => setFormCuenta(c => ({ ...c, naturaleza: e.target.value }))} style={inp}>
                  <option value="deudora">Deudora (aumenta con Debe)</option>
                  <option value="acreedora">Acreedora (aumenta con Haber)</option>
                </select>
              </Campo>
            </div>
            <div style={modalFooter}>
              <button type="button" onClick={() => { setModalCuenta(false); setEditandoCuenta(null) }} style={btnSecondary}>Cancelar</button>
              <button type="submit" disabled={guardandoCuenta} style={btnPrimary}>{guardandoCuenta ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── MODAL PERÍODO ── */}
      {modalPeriodo && (
        <Modal titulo="Nuevo período contable" cerrar={() => setModalPeriodo(false)} ancho={420}>
          <form onSubmit={crearPeriodo}>
            <Campo label="Período (YYYY-MM)">
              <input type="month" value={formPeriodo.periodo} onChange={e => setFormPeriodo({ periodo: e.target.value })} style={inp} autoFocus />
            </Campo>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 10 }}>
              El período se creará como <strong>abierto</strong> y permitirá registrar pólizas en ese mes.
            </div>
            <div style={modalFooter}>
              <button type="button" onClick={() => setModalPeriodo(false)} style={btnSecondary}>Cancelar</button>
              <button type="submit" disabled={guardandoPeriodo} style={btnPrimary}>{guardandoPeriodo ? 'Creando...' : 'Crear período'}</button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  )
}


/* =========================================================
   REPORTES (sin cambios)
========================================================= */

function BalanceGeneral({ data, ventasPeriodo }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 24 }}>
        <ResumenCard titulo="Total Activo"             valor={data.total_activo} />
        <ResumenCard titulo="Total Pasivo"             valor={data.total_pasivo} />
        <ResumenCard titulo="Capital"                  valor={data.total_capital} />
        <ResumenCard titulo="Resultado del ejercicio"  valor={data.resultado_ejercicio} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel titulo="Activo"><TablaCuentas cuentas={data.activo} /></Panel>
        <Panel titulo="Pasivo"><TablaCuentas cuentas={data.pasivo} /></Panel>
      </div>
      <Panel titulo="Capital"><TablaCuentas cuentas={data.capital} /></Panel>
      <div style={{ marginTop: 20, padding: 20, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, color: '#334155' }}>Resultado del ejercicio</span>
          <strong style={{ fontSize: 20, color: data.resultado_ejercicio >= 0 ? '#15803d' : '#b91c1c' }}>
            {dinero(data.resultado_ejercicio)}
          </strong>
        </div>
      </div>
      <div style={{ marginTop: 20, padding: 20, borderRadius: 10, border: data.cuadrado ? '1px solid #bbf7d0' : '1px solid #fecaca', background: data.cuadrado ? '#f0fdf4' : '#fef2f2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 15 }}>
          <div>
            <div style={{ fontWeight: 700, color: data.cuadrado ? '#166534' : '#991b1b', fontSize: 16 }}>
              {data.cuadrado ? '✓ Balance cuadrado' : '⚠ Balance descuadrado'}
            </div>
            <div style={{ marginTop: 5, color: '#64748b', fontSize: 13 }}>Pasivo + Capital + Resultado</div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{dinero(data.total_pasivo_capital_resultado)}</div>
          <div style={{ fontSize: 13, color: '#64748b' }}>Diferencia: <strong>{dinero(data.diferencia)}</strong></div>
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <VentasPeriodo data={ventasPeriodo} />
      </div>
    </div>
  )
}

// Movimientos de venta del periodo: barras por día (mostrador y pedidos) y lista de movimientos
function VentasPeriodo({ data }) {
  const [visibles, setVisibles] = useState(50)
  if (!data) return null
  const { dias, totales, movimientos } = data
  const maximo = Math.max(1, ...dias.map(d => d.total))
  const fechaLarga = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX')
  const canal = { mostrador: 'Mostrador', pedido: 'Pedido' }

  return (
    <Panel titulo="Movimientos de venta del periodo">
      <div style={{ padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Total vendido</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{dinero(totales.total)}</div>
          </div>
          <div style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Ventas</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{totales.cantidad}</div>
          </div>
          <div style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Ticket promedio</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a' }}>{dinero(totales.ticket_promedio)}</div>
          </div>
          <div style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 10 }}>
            <div style={{ color: '#64748b', fontSize: 12 }}>Mostrador / Pedidos</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              {dinero(totales.por_canal.mostrador)} / {dinero(totales.por_canal.pedido)}
            </div>
          </div>
        </div>

        {dias.length === 0 ? (
          <div style={{ color: '#64748b' }}>No hay ventas en este periodo.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 13, color: '#475569' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#2563eb', marginRight: 6 }} />Mostrador</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#16a34a', marginRight: 6 }} />Pedido</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 180, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
              {dias.map(d => (
                <div key={d.fecha} title={`${fechaLarga(d.fecha)}: ${dinero(d.total)} (${d.cantidad} ventas)`}
                  style={{ flex: 1, maxWidth: 48, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <div style={{ width: '100%', height: `${(d.total / maximo) * 100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: '4px 4px 0 0', overflow: 'hidden' }}>
                    <div style={{ height: `${(d.mostrador / d.total) * 100}%`, background: '#2563eb' }} />
                    <div style={{ height: `${(d.pedido / d.total) * 100}%`, background: '#16a34a' }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>{Number(d.fecha.slice(8))}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {movimientos.length > 0 && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1.2fr 1fr', gap: 8, padding: '8px 0', borderBottom: '2px solid #e2e8f0', fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>
              <span>Fecha</span><span>Canal</span><span>Referencia</span><span>Detalle</span><span style={{ textAlign: 'right' }}>Total</span>
            </div>
            {movimientos.slice(0, visibles).map((m, i) => (
              <div key={`${m.referencia}-${i}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr 1.2fr 1fr', gap: 8, padding: '9px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' }}>
                <span>{fechaLarga(m.fecha)}</span>
                <span>{canal[m.canal] || m.canal}</span>
                <span style={{ fontWeight: 600 }}>{m.referencia}</span>
                <span>{m.detalle}</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{dinero(m.total)}</span>
              </div>
            ))}
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, color: '#64748b', fontSize: 12 }}>
              <span>Mostrando {Math.min(visibles, movimientos.length)} de {movimientos.length} movimientos.</span>
              {visibles < movimientos.length && (
                <button onClick={() => setVisibles(v => v + 50)}
                  style={{ background: '#fff', border: '1px solid #cbd5e1', color: '#334155', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                  Mostrar 50 más
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

function EstadoResultados({ data }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 24 }}>
        <ResumenCard titulo="Ingresos" valor={data.total_ingresos} />
        <ResumenCard titulo="Costos"   valor={data.total_costos} />
        <ResumenCard titulo="Gastos"   valor={data.total_gastos} />
        <ResumenCard titulo="Utilidad" valor={data.utilidad} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
        <Panel titulo="Ingresos"><TablaCuentas cuentas={data.ingresos} /></Panel>
        <Panel titulo="Costos">  <TablaCuentas cuentas={data.costos}  /></Panel>
        <Panel titulo="Gastos">  <TablaCuentas cuentas={data.gastos}  /></Panel>
      </div>
      <div style={{ marginTop: 20, padding: 22, borderRadius: 10, background: data.utilidad >= 0 ? '#f0fdf4' : '#fef2f2', border: data.utilidad >= 0 ? '1px solid #bbf7d0' : '1px solid #fecaca' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{data.resultado === 'utilidad' ? 'Utilidad del ejercicio' : 'Pérdida del ejercicio'}</strong>
          <strong style={{ fontSize: 22, color: data.utilidad >= 0 ? '#15803d' : '#b91c1c' }}>{dinero(data.utilidad)}</strong>
        </div>
      </div>
    </div>
  )
}

function Balanza({ data }) {
  return (
    <Panel titulo="Balanza de comprobación">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
              <th style={th}>Código</th><th style={th}>Cuenta</th>
              <th style={{ ...th, textAlign: 'right' }}>Debe</th>
              <th style={{ ...th, textAlign: 'right' }}>Haber</th>
              <th style={{ ...th, textAlign: 'right' }}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {(data.cuentas || []).map((c) => (
              <tr key={c.cuenta_id}>
                <td style={td}>{c.codigo}</td><td style={td}>{c.nombre}</td>
                <td style={{ ...td, textAlign: 'right' }}>{dinero(c.debe)}</td>
                <td style={{ ...td, textAlign: 'right' }}>{dinero(c.haber)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{dinero(c.saldo)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #cbd5e1', fontWeight: 700 }}>
              <td colSpan="2" style={td}>Totales</td>
              <td style={{ ...td, textAlign: 'right' }}>{dinero(data.total_debe)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{dinero(data.total_haber)}</td>
              <td style={{ ...td, textAlign: 'right' }}>Dif: {dinero(data.diferencia)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div style={{ marginTop: 20, padding: 14, borderRadius: 8, background: data.cuadrada ? '#f0fdf4' : '#fef2f2', color: data.cuadrada ? '#166534' : '#991b1b', fontWeight: 600 }}>
        {data.cuadrada ? '✓ La balanza está cuadrada' : '⚠ La balanza presenta diferencia'}
      </div>
    </Panel>
  )
}


/* =========================================================
   COMPONENTES AUXILIARES
========================================================= */

function TablaCuentas({ cuentas = [] }) {
  if (!cuentas.length) return <div style={{ padding: 20, color: '#94a3b8', textAlign: 'center', fontSize: 14 }}>Sin movimientos</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
          <th style={th}>Código</th><th style={th}>Cuenta</th>
          <th style={{ ...th, textAlign: 'right' }}>Importe</th>
        </tr>
      </thead>
      <tbody>
        {cuentas.map((c) => (
          <tr key={c.cuenta_id}>
            <td style={td}>{c.codigo}</td><td style={td}>{c.nombre}</td>
            <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{dinero(c.importe)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ResumenCard({ titulo, valor }) {
  return (
    <div style={{ padding: 18, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
      <div style={{ color: '#64748b', fontSize: 13, marginBottom: 8 }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>{dinero(valor)}</div>
    </div>
  )
}

function Panel({ titulo, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, color: '#334155' }}>{titulo}</div>
      <div style={{ padding: 18 }}>{children}</div>
    </div>
  )
}

function Modal({ titulo, cerrar, children, ancho = 600 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
      <div style={{ width: '100%', maxWidth: ancho, maxHeight: '92vh', background: '#fff', borderRadius: 9, boxShadow: '0 20px 50px rgba(0,0,0,.2)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>{titulo}</h2>
          <button onClick={cerrar} style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: 25, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(92vh - 65px)' }}>{children}</div>
      </div>
    </div>
  )
}

function Tab({ activo, onClick, children }) {
  return (
    <button onClick={onClick} style={{ border: 'none', borderBottom: activo ? '2px solid #0f172a' : '2px solid transparent', background: 'transparent', padding: '10px 14px', color: activo ? '#0f172a' : '#64748b', fontWeight: activo ? 700 : 500, cursor: 'pointer', fontSize: 14 }}>
      {children}
    </button>
  )
}

function Campo({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={lbl}>{label}</label>
      {children}
    </div>
  )
}

// ── Estilos ────────────────────────────────────────────────

const sel      = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', color: '#334155', fontSize: 14 }
const btnPrimary   = { padding: '8px 14px', border: 'none', borderRadius: 7, background: '#0f172a', color: '#fff', fontSize: 13, cursor: 'pointer' }
const btnSecondary = { padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', color: '#334155', fontSize: 13, cursor: 'pointer' }
const btnSm    = { padding: '5px 9px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', color: '#334155', fontSize: 12, cursor: 'pointer' }
const inp      = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, background: '#fff' }
const lbl      = { display: 'block', fontSize: 12, color: '#475569', marginBottom: 5, fontWeight: 500 }
const card     = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }
const thRow    = { display: 'grid', gap: 8, padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }
const tdRow    = { display: 'grid', gap: 8, alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#334155' }
const badge    = { display: 'inline-block', padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600 }
const th       = { padding: '10px 8px', color: '#64748b', fontWeight: 600 }
const td       = { padding: '10px 8px', borderBottom: '1px solid #f1f5f9' }
const modalFooter = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22, paddingTop: 16, borderTop: '1px solid #e2e8f0' }
