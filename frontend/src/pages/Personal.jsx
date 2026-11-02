import { useState, useEffect, useCallback } from 'react'
import { useNegocio } from '../context/NegocioContext'
import useEsMovil from '../hooks/useEsMovil'
import { AvisoEdicion, BadgeEdicion, estiloCabeceraEdicion, estiloPanelEdicion } from '../components/ModoEdicion'

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const fmtNum = (n) => Number(n || 0).toLocaleString('es-MX')

async function req(url, opts = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.detail || 'Error en la solicitud')
  return data
}

const BADGE = {
  planta:      { bg: '#dbeafe', color: '#1d4ed8', label: 'Planta' },
  temporal:    { bg: '#fef9c3', color: '#a16207', label: 'Temporal' },
  honorarios:  { bg: '#f3e8ff', color: '#7e22ce', label: 'Honorarios' },
  confianza:   { bg: '#dcfce7', color: '#15803d', label: 'Confianza' },
  borrador:    { bg: '#f1f5f9', color: '#64748b', label: 'Borrador' },
  calculado:   { bg: '#dbeafe', color: '#1d4ed8', label: 'Calculado' },
  cerrado:     { bg: '#dcfce7', color: '#15803d', label: 'Cerrado' },
  pendiente:   { bg: '#fef9c3', color: '#a16207', label: 'Pendiente' },
  pagado:      { bg: '#dcfce7', color: '#15803d', label: 'Pagado' },
}

function Chip({ tipo }) {
  const b = BADGE[tipo] || { bg: '#f1f5f9', color: '#64748b', label: tipo }
  return (
    <span style={{ background: b.bg, color: b.color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>
      {b.label}
    </span>
  )
}

const EMPTY_EMP = {
  nombre: '', apellido_paterno: '', apellido_materno: '',
  puesto: '', departamento: '', tipo_contrato: 'planta',
  salario_diario: '', periodo_pago: 'quincenal', fecha_ingreso: '',
  rfc: '', curp: '', nss: '', banco: '', clabe: '', email: '', telefono: '',
}

const EMPTY_PERIODO = {
  nombre: '', tipo_periodo: 'quincenal', fecha_inicio: '', fecha_fin: '',
}

// Prestaciones mínimas de ley (LFT); la prima vacacional se edita en porcentaje
const PRESTACIONES_LEY = { aguinaldo_dias: 15, prima_pct: 25, vacaciones_extra: 0 }

// Mismo cálculo que factor_integracion() del backend, para el primer año (12 días de vacaciones)
const factorPrimerAnio = (c) =>
  1 + (Number(c.aguinaldo_dias) + (12 + Number(c.vacaciones_extra)) * Number(c.prima_pct) / 100) / 365

// Empleado como tarjeta para celular; los botones llegan como children
function EmpleadoTarjeta({ e, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', opacity: e.activo ? 1 : 0.65 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[e.nombre, e.apellido_paterno, e.apellido_materno].filter(Boolean).join(' ')}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {[e.puesto, e.departamento].filter(Boolean).join(' · ') || 'Sin puesto'}
            {!e.activo && <> · <span style={{ color: '#b91c1c' }}>Baja</span></>}
          </div>
        </div>
        {e.tipo_contrato && <Chip tipo={e.tipo_contrato} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b', minWidth: 0 }}>
          {e.fecha_ingreso && <div>Ingreso: {e.fecha_ingreso}</div>}
          {e.telefono && <div>{e.telefono}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Salario diario</div>
          <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>{fmt(e.salario_diario)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
        {children}
      </div>
    </div>
  )
}

// Período de nómina como tarjeta para celular; los botones llegan como children
function PeriodoTarjeta({ p, children }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{p.nombre}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {p.fecha_inicio} — {p.fecha_fin}
            {p.tipo_periodo && <span style={{ textTransform: 'capitalize' }}> · {p.tipo_periodo}</span>}
          </div>
        </div>
        <Chip tipo={p.estado} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Percepciones</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#15803d', whiteSpace: 'nowrap' }}>{fmt(p.total_percepciones)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Deducciones</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#b91c1c', whiteSpace: 'nowrap' }}>{fmt(p.total_deducciones)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>Neto</div>
          <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>{fmt(p.total_neto)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
        {children}
      </div>
    </div>
  )
}

// Recibo de nómina como tarjeta para celular: el neto es lo que más se busca
function ReciboTarjeta({ r, onEditar }) {
  const monto = (label, valor, color, grande) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontWeight: grande ? 700 : 600, fontSize: grande ? 16 : 14, color, whiteSpace: 'nowrap' }}>{fmt(valor)}</div>
    </div>
  )
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.empleado_nombre}</div>
          {r.puesto && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{r.puesto}</div>}
        </div>
        <Chip tipo={r.estado} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        {monto('Percepciones', r.total_percepciones, '#15803d')}
        {monto('Deducciones', r.total_deducciones, '#b91c1c')}
        <div style={{ textAlign: 'right' }}>{monto('Neto', r.total_neto, '#1e293b', true)}</div>
      </div>
      {onEditar && (
        <button onClick={onEditar} style={{ width: '100%', marginTop: 12, padding: '10px 12px', border: 'none', borderRadius: 6, background: '#f1f5f9', color: '#334155', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Editar recibo
        </button>
      )}
    </div>
  )
}

export default function Personal() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()
  const esMovil = useEsMovil()
  const esAdmin = JSON.parse(localStorage.getItem('user') || '{}').rol === 'admin'
  const [vista, setVista] = useState('dashboard')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Dashboard
  const [dash, setDash] = useState(null)

  // Empleados
  const [empleados, setEmpleados] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [busquedaQ, setBusquedaQ] = useState('') // versión con debounce: es la que consulta la API
  const [soloActivos, setSoloActivos] = useState(true)
  const [modalEmp, setModalEmp] = useState(false)
  const [editEmp, setEditEmp] = useState(null)
  const [formEmp, setFormEmp] = useState(EMPTY_EMP)
  const [guardandoEmp, setGuardandoEmp] = useState(false)

  // Nómina
  const [periodos, setPeriodos] = useState([])
  const [modalPeriodo, setModalPeriodo] = useState(false)
  const [formPeriodo, setFormPeriodo] = useState(EMPTY_PERIODO)
  const [guardandoPer, setGuardandoPer] = useState(false)

  // Recibos
  const [periodoActivo, setPeriodoActivo] = useState(null)
  const [recibos, setRecibos] = useState([])
  const [modalRecibos, setModalRecibos] = useState(false)
  const [reciboEdit, setReciboEdit] = useState(null)
  const [modalRecibo, setModalRecibo] = useState(false)
  const [formRecibo, setFormRecibo] = useState({ percepciones: [], deducciones: [] })
  const [guardandoRec, setGuardandoRec] = useState(false)
  const [lineaP, setLineaP] = useState({ concepto: '', monto: '' })
  const [lineaD, setLineaD] = useState({ concepto: '', monto: '' })

  // Prestaciones (factor de integración)
  const [formCfg, setFormCfg] = useState(PRESTACIONES_LEY)
  const [guardandoCfg, setGuardandoCfg] = useState(false)
  const [msgCfg, setMsgCfg] = useState('')

  // ── Loaders ────────────────────────────────────────────────────────────────

  const cargarDash = useCallback(async () => {
    if (!negocioId) return
    try {
      const d = await req(`/api/personal/dashboard?negocio_id=${encodeURIComponent(negocioId)}`)
      setDash(d)
    } catch (e) { setError(e.message) }
  }, [negocioId])

  const cargarEmpleados = useCallback(async () => {
    if (!negocioId) return
    setCargando(true); setError('')
    try {
      const data = await req(
        `/api/personal/empleados?negocio_id=${encodeURIComponent(negocioId)}&solo_activos=${soloActivos}&busqueda=${encodeURIComponent(busquedaQ)}`
      )
      setEmpleados(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId, soloActivos, busquedaQ])

  const cargarPeriodos = useCallback(async () => {
    if (!negocioId) return
    setCargando(true); setError('')
    try {
      const data = await req(`/api/personal/nomina/periodos?negocio_id=${encodeURIComponent(negocioId)}`)
      setPeriodos(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId])

  const cargarRecibos = useCallback(async (periodoId) => {
    if (!negocioId || !periodoId) return
    try {
      const data = await req(
        `/api/personal/nomina/recibos?negocio_id=${encodeURIComponent(negocioId)}&periodo_id=${encodeURIComponent(periodoId)}`
      )
      setRecibos(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
  }, [negocioId])

  const cargarConfig = useCallback(async () => {
    if (!negocioId) return
    setMsgCfg('')
    try {
      const c = await req(`/api/personal/nomina/config?negocio_id=${encodeURIComponent(negocioId)}`)
      setFormCfg({
        aguinaldo_dias: c.aguinaldo_dias,
        prima_pct: Math.round(c.prima_vacacional * 10000) / 100,
        vacaciones_extra: c.vacaciones_extra,
      })
    } catch (e) { setError(e.message) }
  }, [negocioId])

  useEffect(() => {
    if (vista === 'dashboard') cargarDash()
    if (vista === 'empleados') cargarEmpleados()
    if (vista === 'nomina') cargarPeriodos()
    if (vista === 'prestaciones') cargarConfig()
  }, [vista, negocioId])

  // Debounce: la búsqueda consulta la API 400 ms después de la última tecla
  useEffect(() => {
    const t = setTimeout(() => setBusquedaQ(busqueda), 400)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (vista === 'empleados') cargarEmpleados()
  }, [busquedaQ, soloActivos])

  // ── Empleados ──────────────────────────────────────────────────────────────

  function abrirNuevoEmp() { setEditEmp(null); setFormEmp(EMPTY_EMP); setError(''); setModalEmp(true) }
  function abrirEditarEmp(e) {
    setEditEmp(e)
    setFormEmp({
      nombre: e.nombre || '', apellido_paterno: e.apellido_paterno || '',
      apellido_materno: e.apellido_materno || '', puesto: e.puesto || '',
      departamento: e.departamento || '', tipo_contrato: e.tipo_contrato || 'planta',
      salario_diario: e.salario_diario ?? '', periodo_pago: e.periodo_pago || 'quincenal',
      fecha_ingreso: e.fecha_ingreso || '', rfc: e.rfc || '', curp: e.curp || '',
      nss: e.nss || '', banco: e.banco || '', clabe: e.clabe || '',
      email: e.email || '', telefono: e.telefono || '',
    })
    setError(''); setModalEmp(true)
  }

  async function guardarEmpleado(ev) {
    ev.preventDefault()
    if (!formEmp.nombre.trim()) { setError('El nombre es requerido'); return }
    if (Number(formEmp.salario_diario) < 0) { setError('El salario no puede ser negativo'); return }
    setGuardandoEmp(true); setError('')
    try {
      const payload = { ...formEmp, salario_diario: Number(formEmp.salario_diario) || 0 }
      if (editEmp) {
        const r = await req(`/api/personal/empleados/${editEmp.id}`, { method: 'PUT', body: JSON.stringify(payload) })
        if (r.recibos_recalculados > 0) alert(`Recibos pendientes recalculados: ${r.recibos_recalculados}`)
      } else {
        await req('/api/personal/empleados', { method: 'POST', body: JSON.stringify({ ...payload, negocio_id: negocioId }) })
      }
      setModalEmp(false)
      await cargarEmpleados()
    } catch (e) { setError(e.message) }
    finally { setGuardandoEmp(false) }
  }

  async function desactivarEmpleado(id) {
    if (!window.confirm('¿Dar de baja a este empleado?')) return
    try {
      await req(`/api/personal/empleados/${id}`, { method: 'DELETE' })
      await cargarEmpleados()
    } catch (e) { setError(e.message) }
  }

  async function reactivarEmpleado(id) {
    if (!window.confirm('¿Reactivar a este empleado?')) return
    try {
      await req(`/api/personal/empleados/${id}/reactivar`, { method: 'PATCH' })
      await cargarEmpleados()
    } catch (e) { setError(e.message) }
  }

  // ── Nómina ─────────────────────────────────────────────────────────────────

  async function guardarPeriodo(ev) {
    ev.preventDefault()
    if (!formPeriodo.nombre.trim()) { setError('El nombre es requerido'); return }
    if (!formPeriodo.fecha_inicio || !formPeriodo.fecha_fin) { setError('Las fechas son requeridas'); return }
    setGuardandoPer(true); setError('')
    try {
      await req('/api/personal/nomina/periodos', {
        method: 'POST',
        body: JSON.stringify({ ...formPeriodo, negocio_id: negocioId }),
      })
      setModalPeriodo(false); setFormPeriodo(EMPTY_PERIODO)
      await cargarPeriodos()
    } catch (e) { setError(e.message) }
    finally { setGuardandoPer(false) }
  }

  async function calcularNomina(id) {
    try {
      const r = await req(`/api/personal/nomina/periodos/${id}/calcular`, { method: 'PATCH' })
      await cargarPeriodos()
      return r
    } catch (e) { setError(e.message) }
  }

  // Crea la póliza de diario en borrador en Contabilidad, con los totales del período
  async function generarPoliza(id) {
    try {
      const r = await req(`/api/personal/nomina/periodos/${id}/poliza`, { method: 'POST' })
      alert(`Póliza ${r.numero} creada en borrador (periodo contable ${r.periodo}). Revísala y contabilízala en Contabilidad.`)
    } catch (e) { setError(e.message) }
  }

  async function cambiarEstadoPeriodo(id, accion) {
    try {
      await req(`/api/personal/nomina/periodos/${id}/${accion}`, { method: 'PATCH' })
      await cargarPeriodos()
    } catch (e) { setError(e.message) }
  }

  // Botones de un período según su estado; los usan la tabla y las tarjetas del celular
  function accionesPeriodo(p, btn) {
    return (
      <>
        <button style={btn('ghost')} onClick={() => verRecibos(p)}>Ver recibos</button>
        {p.estado === 'borrador' && (
          <button style={btn()} onClick={async () => {
            const r = await calcularNomina(p.id)
            if (r) alert(`Nómina calculada. Recibos nuevos: ${r.recibos_creados}`)
          }}>Calcular</button>
        )}
        {p.estado === 'calculado' && (
          <>
            <button style={btn()} onClick={async () => {
              const r = await calcularNomina(p.id)
              if (r) alert(`Recalculado. Recibos nuevos: ${r.recibos_creados}`)
            }}>Recalcular</button>
            <button style={btn('success')} onClick={() => {
              if (window.confirm('¿Cerrar el período? No se podrán editar los recibos.'))
                cambiarEstadoPeriodo(p.id, 'cerrar')
            }}>Cerrar</button>
          </>
        )}
        {p.estado === 'cerrado' && (
          <button style={btn('ghost')} onClick={() => {
            if (window.confirm('¿Reabrir el período?')) cambiarEstadoPeriodo(p.id, 'reabrir')
          }}>Reabrir</button>
        )}
        {p.estado !== 'borrador' && (
          <button style={btn('ghost')} onClick={() => generarPoliza(p.id)}>Póliza</button>
        )}
      </>
    )
  }

  async function verRecibos(periodo) {
    setPeriodoActivo(periodo)
    await cargarRecibos(periodo.id)
    setModalRecibos(true)
  }

  // ── Recibos ────────────────────────────────────────────────────────────────

  function abrirReciboEdit(r) {
    setReciboEdit(r)
    setFormRecibo({
      percepciones: r.percepciones ? r.percepciones.map(p => ({ ...p })) : [],
      deducciones:  r.deducciones  ? r.deducciones.map(d => ({ ...d }))  : [],
      estado: r.estado || 'pendiente',
    })
    setLineaP({ concepto: '', monto: '' })
    setLineaD({ concepto: '', monto: '' })
    setError(''); setModalRecibo(true)
  }

  function agregarLinea(tipo) {
    const linea = tipo === 'p' ? lineaP : lineaD
    if (!linea.concepto.trim() || !linea.monto || Number(linea.monto) <= 0) return
    const item = { concepto: linea.concepto.trim(), monto: Number(linea.monto) }
    if (tipo === 'p') {
      setFormRecibo(f => ({ ...f, percepciones: [...f.percepciones, item] }))
      setLineaP({ concepto: '', monto: '' })
    } else {
      setFormRecibo(f => ({ ...f, deducciones: [...f.deducciones, item] }))
      setLineaD({ concepto: '', monto: '' })
    }
  }

  function quitarLinea(tipo, idx) {
    if (tipo === 'p') setFormRecibo(f => ({ ...f, percepciones: f.percepciones.filter((_, i) => i !== idx) }))
    else              setFormRecibo(f => ({ ...f, deducciones:  f.deducciones.filter((_, i) => i !== idx) }))
  }

  async function guardarRecibo(ev) {
    ev.preventDefault()
    setGuardandoRec(true); setError('')
    try {
      await req(`/api/personal/nomina/recibos/${reciboEdit.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          percepciones: formRecibo.percepciones,
          deducciones:  formRecibo.deducciones,
          estado:       formRecibo.estado,
        }),
      })
      setModalRecibo(false)
      await cargarRecibos(periodoActivo.id)
      await cargarPeriodos()
    } catch (e) { setError(e.message) }
    finally { setGuardandoRec(false) }
  }

  async function guardarConfig(ev) {
    ev.preventDefault()
    setGuardandoCfg(true); setError(''); setMsgCfg('')
    try {
      const r = await req('/api/personal/nomina/config', {
        method: 'PUT',
        body: JSON.stringify({
          negocio_id: negocioId,
          aguinaldo_dias: Number(formCfg.aguinaldo_dias),
          prima_vacacional: Number(formCfg.prima_pct) / 100,
          vacaciones_extra: Number(formCfg.vacaciones_extra),
        }),
      })
      setMsgCfg(`Prestaciones guardadas. Recibos pendientes recalculados: ${r.recibos_recalculados}.`)
    } catch (e) { setError(e.message) }
    finally { setGuardandoCfg(false) }
  }

  // ── Cálculos UI ────────────────────────────────────────────────────────────

  const totalP = formRecibo.percepciones.reduce((s, p) => s + Number(p.monto), 0)
  const totalD = formRecibo.deducciones.reduce((s, d) => s + Number(d.monto), 0)
  const totalN = totalP - totalD

  // ── Estilos ────────────────────────────────────────────────────────────────

  const s = {
    page:    { fontFamily: 'system-ui,sans-serif', color: '#1e293b', maxWidth: 1200 },
    h1:      { fontSize: 22, fontWeight: 700, margin: 0 },
    tabs:    { display: 'flex', gap: 4, marginTop: 20, marginBottom: 24, borderBottom: '2px solid #e2e8f0' },
    tab:     (active) => ({
      padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
      fontSize: 14, fontWeight: 600, color: active ? '#3b82f6' : '#64748b',
      borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
      marginBottom: -2,
    }),
    card:    { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
    grid4:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 },
    label:   { fontSize: 12, color: '#64748b', marginBottom: 4 },
    val:     { fontSize: 22, fontWeight: 700 },
    btn:     (v = 'primary') => ({
      padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
      background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'success' ? '#22c55e' : '#f1f5f9',
      color: v === 'ghost' ? '#334155' : '#fff',
    }),
    input:   { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    select:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:      { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
    td:      { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:   (w = 600) => ({ background: '#fff', borderRadius: 12, padding: 28, width: w, maxHeight: '90vh', overflowY: 'auto', maxWidth: '95vw' }),
    mh:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    mTitle:  { fontSize: 17, fontWeight: 700, margin: 0 },
    row2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    row3:    { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
    fgroup:  { display: 'flex', flexDirection: 'column', gap: 4 },
    sect:    { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' },
    err:     { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={s.h1}>Personal & Nómina</h1>
        <select
          value={negocioId}
          onChange={e => { setError(''); setNegocioId(e.target.value) }}
          style={{ ...s.select, width: 'auto', minWidth: 200, background: '#fff' }}
        >
          {negociosDisponibles.map(n => (
            <option key={n.id} value={n.id}>{n.nombre}</option>
          ))}
        </select>
      </div>

      <div style={s.tabs}>
        {[['dashboard','Resumen'],['empleados','Empleados'],['nomina','Nómina'],['prestaciones','Prestaciones']].map(([k,l]) => (
          <button key={k} style={s.tab(vista === k)} onClick={() => { setError(''); setVista(k) }}>{l}</button>
        ))}
      </div>

      {error && <div style={s.err}>{error}</div>}

      {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
      {vista === 'dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={s.grid4}>
            {[
              { label: 'Empleados activos',      val: fmtNum(dash?.total_empleados) },
              { label: 'Masa salarial quincenal', val: fmt(dash?.masa_salarial_quincenal) },
              { label: 'Masa salarial mensual',   val: fmt(dash?.masa_salarial_mensual) },
            ].map(c => (
              <div key={c.label} style={s.card}>
                <div style={s.label}>{c.label}</div>
                <div style={s.val}>{dash ? c.val : '—'}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Por departamento</div>
              {dash?.departamentos && Object.keys(dash.departamentos).length > 0
                ? Object.entries(dash.departamentos).map(([dep, cnt]) => (
                  <div key={dep} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span>{dep}</span>
                    <span style={{ fontWeight: 700 }}>{cnt}</span>
                  </div>
                ))
                : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sin datos</div>}
            </div>
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Por tipo de contrato</div>
              {dash?.contratos && Object.keys(dash.contratos).length > 0
                ? Object.entries(dash.contratos).map(([tipo, cnt]) => (
                  <div key={tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <Chip tipo={tipo} />
                    <span style={{ fontWeight: 700 }}>{cnt}</span>
                  </div>
                ))
                : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sin datos</div>}
            </div>
          </div>

          {dash?.ultimo_periodo && (
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Último período procesado</div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                {dash.ultimo_periodo.nombre} &nbsp;·&nbsp;
                {dash.ultimo_periodo.fecha_inicio} — {dash.ultimo_periodo.fecha_fin} &nbsp;·&nbsp;
                <Chip tipo={dash.ultimo_periodo.estado} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 12 }}>
                {[
                  ['Percepciones', fmt(dash.ultimo_periodo.total_percepciones)],
                  ['Deducciones',  fmt(dash.ultimo_periodo.total_deducciones)],
                  ['Neto',         fmt(dash.ultimo_periodo.total_neto)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{l}</div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EMPLEADOS ─────────────────────────────────────────────────── */}
      {vista === 'empleados' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              style={{ ...s.input, maxWidth: esMovil ? 'none' : 280, flex: esMovil ? '1 1 100%' : undefined }}
              placeholder="Buscar empleado…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
              Solo activos
            </label>
            <button style={{ ...s.btn(), marginLeft: 'auto' }} onClick={abrirNuevoEmp}>+ Nuevo empleado</button>
          </div>

          {cargando
            ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
            : esMovil ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {empleados.length === 0 && (
                  <div style={{ ...s.card, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin empleados registrados</div>
                )}
                {empleados.map(e => {
                  const boton = (v) => ({ ...s.btn(v), flex: 1, padding: '10px 12px', fontSize: 14, textAlign: 'center', textDecoration: 'none' })
                  return (
                    <EmpleadoTarjeta key={e.id} e={e}>
                      {e.telefono && <a href={`tel:${e.telefono.replace(/[^\d+]/g, '')}`} style={boton('success')}>Llamar</a>}
                      <button style={boton('ghost')} onClick={() => abrirEditarEmp(e)}>Editar</button>
                      {esAdmin && e.activo && <button style={boton('danger')} onClick={() => desactivarEmpleado(e.id)}>Baja</button>}
                      {esAdmin && !e.activo && <button style={boton('success')} onClick={() => reactivarEmpleado(e.id)}>Reactivar</button>}
                    </EmpleadoTarjeta>
                  )
                })}
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {['Nombre','Puesto','Departamento','Contrato','Salario/día','Ingreso','Estado',''].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {empleados.length === 0 && (
                      <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Sin empleados registrados</td></tr>
                    )}
                    {empleados.map(e => (
                      <tr key={e.id} style={{ background: e.activo ? '#fff' : '#fafafa' }}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{e.nombre} {e.apellido_paterno} {e.apellido_materno}</div>
                          {e.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{e.email}</div>}
                        </td>
                        <td style={s.td}>{e.puesto || '—'}</td>
                        <td style={s.td}>{e.departamento || '—'}</td>
                        <td style={s.td}><Chip tipo={e.tipo_contrato} /></td>
                        <td style={{ ...s.td, fontWeight: 600 }}>{fmt(e.salario_diario)}</td>
                        <td style={s.td}>{e.fecha_ingreso || '—'}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: 12, color: e.activo ? '#15803d' : '#94a3b8' }}>
                            {e.activo ? 'Activo' : 'Baja'}
                          </span>
                        </td>
                        <td style={{ ...s.td, display: 'flex', gap: 6 }}>
                          <button style={s.btn('ghost')} onClick={() => abrirEditarEmp(e)}>Editar</button>
                          {esAdmin && e.activo && (
                            <button style={s.btn('danger')} onClick={() => desactivarEmpleado(e.id)}>Baja</button>
                          )}
                          {esAdmin && !e.activo && (
                            <button style={s.btn('success')} onClick={() => reactivarEmpleado(e.id)}>Reactivar</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── NÓMINA ────────────────────────────────────────────────────── */}
      {vista === 'nomina' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button style={s.btn()} onClick={() => { setFormPeriodo(EMPTY_PERIODO); setError(''); setModalPeriodo(true) }}>
              + Nuevo período
            </button>
          </div>

          {cargando
            ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
            : esMovil ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {periodos.length === 0 && (
                  <div style={{ ...s.card, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin períodos registrados</div>
                )}
                {periodos.map(p => (
                  <PeriodoTarjeta key={p.id} p={p}>
                    {accionesPeriodo(p, v => ({ ...s.btn(v), flex: '1 1 0', padding: '10px 8px', fontSize: 14 }))}
                  </PeriodoTarjeta>
                ))}
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {['Período','Fechas','Tipo','Estado','Percepciones','Deducciones','Neto','Acciones'].map(h => (
                        <th key={h} style={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {periodos.length === 0 && (
                      <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 32 }}>Sin períodos registrados</td></tr>
                    )}
                    {periodos.map(p => (
                      <tr key={p.id}>
                        <td style={{ ...s.td, fontWeight: 600 }}>{p.nombre}</td>
                        <td style={{ ...s.td, fontSize: 12, color: '#64748b' }}>{p.fecha_inicio} — {p.fecha_fin}</td>
                        <td style={s.td}><span style={{ textTransform: 'capitalize', fontSize: 12 }}>{p.tipo_periodo}</span></td>
                        <td style={s.td}><Chip tipo={p.estado} /></td>
                        <td style={{ ...s.td, color: '#15803d', fontWeight: 600 }}>{fmt(p.total_percepciones)}</td>
                        <td style={{ ...s.td, color: '#b91c1c' }}>{fmt(p.total_deducciones)}</td>
                        <td style={{ ...s.td, fontWeight: 700 }}>{fmt(p.total_neto)}</td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {accionesPeriodo(p, s.btn)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {/* ── PRESTACIONES ──────────────────────────────────────────────── */}
      {vista === 'prestaciones' && (
        <form style={{ ...s.card, maxWidth: 560 }} onSubmit={guardarConfig}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Factor de integración del SBC</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Prestaciones que da el negocio. Se usan para integrar el salario base de cotización del IMSS
            y no pueden ser menores a las de ley.
          </div>
          {!esAdmin && (
            <div style={{ ...s.err, background: '#f1f5f9', color: '#475569' }}>
              Solo un administrador puede modificar las prestaciones.
            </div>
          )}
          <fieldset disabled={!esAdmin} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div style={s.row3}>
              <div style={s.fgroup}>
                <label style={s.label}>Aguinaldo (días)</label>
                <input style={s.input} type="number" min={15} max={365} step="0.5" required
                  value={formCfg.aguinaldo_dias}
                  onChange={e => setFormCfg(f => ({ ...f, aguinaldo_dias: e.target.value }))} />
              </div>
              <div style={s.fgroup}>
                <label style={s.label}>Prima vacacional (%)</label>
                <input style={s.input} type="number" min={25} max={100} step="0.01" required
                  value={formCfg.prima_pct}
                  onChange={e => setFormCfg(f => ({ ...f, prima_pct: e.target.value }))} />
              </div>
              <div style={s.fgroup}>
                <label style={s.label}>Días extra de vacaciones</label>
                <input style={s.input} type="number" min={0} max={60} step="1" required
                  value={formCfg.vacaciones_extra}
                  onChange={e => setFormCfg(f => ({ ...f, vacaciones_extra: e.target.value }))} />
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 16 }}>
              Factor en el primer año: <b style={{ color: '#1e293b' }}>{factorPrimerAnio(formCfg).toFixed(4)}</b>
              &nbsp;(de ley: 1.0493). Los días extra se suman a la tabla de vacaciones de ley en cada año de antigüedad.
            </div>
            {msgCfg && <div style={{ fontSize: 13, color: '#15803d', marginTop: 12 }}>{msgCfg}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button type="button" style={s.btn('ghost')} onClick={() => setFormCfg(PRESTACIONES_LEY)}>Restablecer a ley</button>
              <button type="submit" style={s.btn()} disabled={guardandoCfg}>{guardandoCfg ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </fieldset>
        </form>
      )}

      {/* ── MODAL EMPLEADO ────────────────────────────────────────────── */}
      {modalEmp && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModalEmp(false)}>
          <div style={estiloPanelEdicion(Boolean(editEmp), s.modal(720))}>
            <div style={estiloCabeceraEdicion(Boolean(editEmp), s.mh)}>
              <div>
                {editEmp && <BadgeEdicion />}
                <h2 style={s.mTitle}>{editEmp ? 'Editar empleado' : 'Nuevo empleado'}</h2>
              </div>
              <button style={{ ...s.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalEmp(false)}>×</button>
            </div>
            {editEmp && <AvisoEdicion entidad={`el empleado ${editEmp.nombre || ''}`.trim()} />}
            {error && <div style={s.err}>{error}</div>}
            <form onSubmit={guardarEmpleado}>
              <div style={s.sect}>Datos personales</div>
              <div style={s.row3}>
                <div style={s.fgroup}>
                  <label style={s.label}>Nombre *</label>
                  <input style={s.input} value={formEmp.nombre} onChange={e => setFormEmp(f => ({ ...f, nombre: e.target.value }))} required />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Apellido paterno</label>
                  <input style={s.input} value={formEmp.apellido_paterno} onChange={e => setFormEmp(f => ({ ...f, apellido_paterno: e.target.value }))} />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Apellido materno</label>
                  <input style={s.input} value={formEmp.apellido_materno} onChange={e => setFormEmp(f => ({ ...f, apellido_materno: e.target.value }))} />
                </div>
              </div>
              <div style={{ ...s.row2, marginTop: 12 }}>
                <div style={s.fgroup}>
                  <label style={s.label}>Email</label>
                  <input style={s.input} type="email" value={formEmp.email} onChange={e => setFormEmp(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Teléfono</label>
                  <input style={s.input} value={formEmp.telefono} onChange={e => setFormEmp(f => ({ ...f, telefono: e.target.value }))} />
                </div>
              </div>
              <div style={{ ...s.row3, marginTop: 12 }}>
                <div style={s.fgroup}>
                  <label style={s.label}>RFC</label>
                  <input style={s.input} value={formEmp.rfc} onChange={e => setFormEmp(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} maxLength={13} />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>CURP</label>
                  <input style={s.input} value={formEmp.curp} onChange={e => setFormEmp(f => ({ ...f, curp: e.target.value.toUpperCase() }))} maxLength={18} />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>NSS</label>
                  <input style={s.input} value={formEmp.nss} onChange={e => setFormEmp(f => ({ ...f, nss: e.target.value }))} maxLength={11} />
                </div>
              </div>

              <div style={s.sect}>Datos laborales</div>
              <div style={s.row2}>
                <div style={s.fgroup}>
                  <label style={s.label}>Puesto</label>
                  <input style={s.input} value={formEmp.puesto} onChange={e => setFormEmp(f => ({ ...f, puesto: e.target.value }))} />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Departamento</label>
                  <input style={s.input} value={formEmp.departamento} onChange={e => setFormEmp(f => ({ ...f, departamento: e.target.value }))} />
                </div>
              </div>
              <div style={{ ...s.row3, marginTop: 12 }}>
                <div style={s.fgroup}>
                  <label style={s.label}>Tipo contrato</label>
                  <select style={s.select} value={formEmp.tipo_contrato} onChange={e => setFormEmp(f => ({ ...f, tipo_contrato: e.target.value }))}>
                    <option value="planta">Planta</option>
                    <option value="temporal">Temporal</option>
                    <option value="honorarios">Honorarios</option>
                    <option value="confianza">Confianza</option>
                  </select>
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Período de pago</label>
                  <select style={s.select} value={formEmp.periodo_pago} onChange={e => setFormEmp(f => ({ ...f, periodo_pago: e.target.value }))}>
                    <option value="semanal">Semanal</option>
                    <option value="quincenal">Quincenal</option>
                    <option value="mensual">Mensual</option>
                  </select>
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Fecha ingreso</label>
                  <input style={s.input} type="date" value={formEmp.fecha_ingreso} onChange={e => setFormEmp(f => ({ ...f, fecha_ingreso: e.target.value }))} />
                </div>
              </div>
              <div style={{ ...s.row2, marginTop: 12 }}>
                <div style={s.fgroup}>
                  <label style={s.label}>Salario diario (MXN) *</label>
                  <input style={s.input} type="number" min="0" step="0.01" value={formEmp.salario_diario} onChange={e => setFormEmp(f => ({ ...f, salario_diario: e.target.value }))} required />
                </div>
              </div>

              <div style={s.sect}>Datos bancarios</div>
              <div style={s.row3}>
                <div style={s.fgroup}>
                  <label style={s.label}>Banco</label>
                  <input style={s.input} value={formEmp.banco} onChange={e => setFormEmp(f => ({ ...f, banco: e.target.value }))} />
                </div>
                <div style={{ ...s.fgroup, gridColumn: 'span 2' }}>
                  <label style={s.label}>CLABE interbancaria</label>
                  <input style={s.input} value={formEmp.clabe} onChange={e => setFormEmp(f => ({ ...f, clabe: e.target.value }))} maxLength={18} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" style={s.btn('ghost')} onClick={() => setModalEmp(false)}>Cancelar</button>
                <button type="submit" style={s.btn()} disabled={guardandoEmp}>
                  {guardandoEmp ? 'Guardando…' : editEmp ? 'Guardar cambios' : 'Crear empleado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL NUEVO PERÍODO ───────────────────────────────────────── */}
      {modalPeriodo && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModalPeriodo(false)}>
          <div style={s.modal(480)}>
            <div style={s.mh}>
              <h2 style={s.mTitle}>Nuevo período de nómina</h2>
              <button style={{ ...s.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalPeriodo(false)}>×</button>
            </div>
            {error && <div style={s.err}>{error}</div>}
            <form onSubmit={guardarPeriodo}>
              <div style={s.fgroup}>
                <label style={s.label}>Nombre del período *</label>
                <input style={s.input} placeholder="Ej. Quincena 1 Octubre 2026" value={formPeriodo.nombre}
                  onChange={e => setFormPeriodo(f => ({ ...f, nombre: e.target.value }))} required />
              </div>
              <div style={{ ...s.fgroup, marginTop: 12 }}>
                <label style={s.label}>Tipo</label>
                <select style={s.select} value={formPeriodo.tipo_periodo}
                  onChange={e => setFormPeriodo(f => ({ ...f, tipo_periodo: e.target.value }))}>
                  <option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>
              <div style={{ ...s.row2, marginTop: 12 }}>
                <div style={s.fgroup}>
                  <label style={s.label}>Fecha inicio *</label>
                  <input style={s.input} type="date" value={formPeriodo.fecha_inicio}
                    onChange={e => setFormPeriodo(f => ({ ...f, fecha_inicio: e.target.value }))} required />
                </div>
                <div style={s.fgroup}>
                  <label style={s.label}>Fecha fin *</label>
                  <input style={s.input} type="date" value={formPeriodo.fecha_fin}
                    onChange={e => setFormPeriodo(f => ({ ...f, fecha_fin: e.target.value }))} required />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" style={s.btn('ghost')} onClick={() => setModalPeriodo(false)}>Cancelar</button>
                <button type="submit" style={s.btn()} disabled={guardandoPer}>
                  {guardandoPer ? 'Guardando…' : 'Crear período'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL RECIBOS DEL PERÍODO ─────────────────────────────────── */}
      {modalRecibos && periodoActivo && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModalRecibos(false)}>
          <div style={{ ...s.modal(900), width: 900 }}>
            <div style={s.mh}>
              <div>
                <h2 style={s.mTitle}>{periodoActivo.nombre}</h2>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  {periodoActivo.fecha_inicio} — {periodoActivo.fecha_fin} &nbsp;·&nbsp; <Chip tipo={periodoActivo.estado} />
                </div>
              </div>
              <button style={{ ...s.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalRecibos(false)}>×</button>
            </div>

            {/* Totales: en celular, una sola tarjeta con un renglón por total */}
            {esMovil ? (
              <div style={{ ...s.card, padding: '10px 14px', marginBottom: 12 }}>
                {[
                  ['Percepciones', fmt(periodoActivo.total_percepciones), '#15803d'],
                  ['Deducciones',  fmt(periodoActivo.total_deducciones),  '#b91c1c'],
                  ['Neto a pagar', fmt(periodoActivo.total_neto),          '#1d4ed8'],
                ].map(([l, v, c], i) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '5px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>{l}</span>
                    <span style={{ fontWeight: 700, fontSize: i === 2 ? 17 : 15, color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 16 }}>
              {[
                ['Total percepciones', fmt(periodoActivo.total_percepciones), '#15803d'],
                ['Total deducciones',  fmt(periodoActivo.total_deducciones),  '#b91c1c'],
                ['Total neto',         fmt(periodoActivo.total_neto),          '#1d4ed8'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ ...s.card, padding: '12px 16px' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{l}</div>
                  <div style={{ fontWeight: 700, fontSize: 17, color: c }}>{v}</div>
                </div>
              ))}
            </div>
            )}

            {esMovil ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recibos.length === 0 && (
                  <div style={{ ...s.card, padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                    Sin recibos — usa el botón "Calcular" en el período para generarlos.
                  </div>
                )}
                {recibos.map(r => <ReciboTarjeta key={r.id} r={r} onEditar={periodoActivo.estado !== 'cerrado' ? () => abrirReciboEdit(r) : null} />)}
              </div>
            ) : (
            <table style={s.table}>
              <thead>
                <tr>
                  {['Empleado','Puesto','Percepciones','Deducciones','Neto','Estado',''].map(h => (
                    <th key={h} style={s.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recibos.length === 0 && (
                  <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                    Sin recibos — usa el botón "Calcular" en el período para generarlos.
                  </td></tr>
                )}
                {recibos.map(r => (
                  <tr key={r.id}>
                    <td style={s.td}><div style={{ fontWeight: 600 }}>{r.empleado_nombre}</div></td>
                    <td style={{ ...s.td, color: '#64748b' }}>{r.puesto || '—'}</td>
                    <td style={{ ...s.td, color: '#15803d', fontWeight: 600 }}>{fmt(r.total_percepciones)}</td>
                    <td style={{ ...s.td, color: '#b91c1c' }}>{fmt(r.total_deducciones)}</td>
                    <td style={{ ...s.td, fontWeight: 700 }}>{fmt(r.total_neto)}</td>
                    <td style={s.td}><Chip tipo={r.estado} /></td>
                    <td style={s.td}>
                      {periodoActivo.estado !== 'cerrado' && (
                        <button style={s.btn('ghost')} onClick={() => abrirReciboEdit(r)}>Editar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL EDITAR RECIBO ───────────────────────────────────────── */}
      {modalRecibo && reciboEdit && (
        <div style={{ ...s.overlay, zIndex: 1100 }} onClick={e => e.target === e.currentTarget && setModalRecibo(false)}>
          <div style={s.modal(620)}>
            <div style={s.mh}>
              <h2 style={s.mTitle}>Recibo: {reciboEdit.empleado_nombre}</h2>
              <button style={{ ...s.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalRecibo(false)}>×</button>
            </div>
            {error && <div style={s.err}>{error}</div>}
            <form onSubmit={guardarRecibo}>

              {/* Percepciones */}
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#15803d' }}>Percepciones</div>
              {formRecibo.percepciones.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{p.concepto}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{fmt(p.monto)}</span>
                  <button type="button" style={{ ...s.btn('danger'), padding: '3px 8px', fontSize: 12 }} onClick={() => quitarLinea('p', i)}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <input style={{ ...s.input, flex: 2 }} placeholder="Concepto" value={lineaP.concepto}
                  onChange={e => setLineaP(l => ({ ...l, concepto: e.target.value }))} />
                <input style={{ ...s.input, flex: 1 }} type="number" min="0" step="0.01" placeholder="Monto"
                  value={lineaP.monto} onChange={e => setLineaP(l => ({ ...l, monto: e.target.value }))} />
                <button type="button" style={s.btn('success')} onClick={() => agregarLinea('p')}>+</button>
              </div>

              {/* Deducciones */}
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#b91c1c' }}>Deducciones</div>
              {formRecibo.deducciones.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{d.concepto}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{fmt(d.monto)}</span>
                  <button type="button" style={{ ...s.btn('danger'), padding: '3px 8px', fontSize: 12 }} onClick={() => quitarLinea('d', i)}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                <input style={{ ...s.input, flex: 2 }} placeholder="Concepto" value={lineaD.concepto}
                  onChange={e => setLineaD(l => ({ ...l, concepto: e.target.value }))} />
                <input style={{ ...s.input, flex: 1 }} type="number" min="0" step="0.01" placeholder="Monto"
                  value={lineaD.monto} onChange={e => setLineaD(l => ({ ...l, monto: e.target.value }))} />
                <button type="button" style={s.btn('success')} onClick={() => agregarLinea('d')}>+</button>
              </div>

              {/* Totales */}
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#64748b' }}>Total percepciones</span>
                  <span style={{ color: '#15803d', fontWeight: 700 }}>{fmt(totalP)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#64748b' }}>Total deducciones</span>
                  <span style={{ color: '#b91c1c', fontWeight: 700 }}>{fmt(totalD)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 4 }}>
                  <span style={{ fontWeight: 700 }}>Neto a pagar</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: '#1d4ed8' }}>{fmt(totalN)}</span>
                </div>
              </div>

              {/* Estado */}
              <div style={s.fgroup}>
                <label style={s.label}>Estado del recibo</label>
                <select style={s.select} value={formRecibo.estado}
                  onChange={e => setFormRecibo(f => ({ ...f, estado: e.target.value }))}>
                  <option value="pendiente">Pendiente</option>
                  <option value="pagado">Pagado</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button type="button" style={s.btn('ghost')} onClick={() => setModalRecibo(false)}>Cancelar</button>
                <button type="submit" style={s.btn()} disabled={guardandoRec}>
                  {guardandoRec ? 'Guardando…' : 'Guardar recibo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
