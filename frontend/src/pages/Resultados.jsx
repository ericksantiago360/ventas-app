import { useState, useEffect, useCallback, useRef } from 'react'
import { useNegocio } from '../context/NegocioContext'
import useEsMovil from '../hooks/useEsMovil'

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

async function abrirPdf(ordenId) {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/lab/ordenes/${ordenId}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('No se pudo generar el PDF')
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const fmt = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const hoy = () => new Date().toISOString().split('T')[0]

// ── Flags ──────────────────────────────────────────────────────────────────────
const FLAG_STYLE = {
  normal:   { bg: '#dcfce7', color: '#15803d', label: 'Normal' },
  alto:     { bg: '#fef9c3', color: '#a16207', label: 'Alto ↑' },
  bajo:     { bg: '#dbeafe', color: '#1d4ed8', label: 'Bajo ↓' },
  critico:  { bg: '#fee2e2', color: '#b91c1c', label: '⚠ Crítico' },
  pendiente:{ bg: '#f1f5f9', color: '#94a3b8', label: '—' },
}

const ESTADO_ORDEN = {
  pendiente:  { bg: '#f1f5f9', color: '#64748b' },
  en_proceso: { bg: '#fef9c3', color: '#a16207' },
  completado: { bg: '#dcfce7', color: '#15803d' },
  entregado:  { bg: '#dbeafe', color: '#1d4ed8' },
}

const ESTADO_RES = {
  pendiente: { bg: '#f1f5f9', color: '#94a3b8' },
  capturado: { bg: '#fef9c3', color: '#a16207' },
  validado:  { bg: '#dcfce7', color: '#15803d' },
}

function FlagChip({ flag }) {
  const f = FLAG_STYLE[flag] || FLAG_STYLE.pendiente
  return <span style={{ background: f.bg, color: f.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{f.label}</span>
}
function EstadoChip({ estado, map }) {
  const e = map[estado] || { bg: '#f1f5f9', color: '#64748b' }
  return <span style={{ background: e.bg, color: e.color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{estado?.replace('_', ' ')}</span>
}

function calcularFlagJS(valor, tipo, min, max) {
  if (tipo === 'cualitativo') return 'normal'
  const num = parseFloat(valor)
  if (isNaN(num) || valor === '') return 'pendiente'
  if (min != null && max != null) {
    if (num < min) return (min > 0 && num < min * 0.7) ? 'critico' : 'bajo'
    if (num > max) return num > max * 1.3 ? 'critico' : 'alto'
    return 'normal'
  }
  return 'pendiente'
}

// ── Estilos ────────────────────────────────────────────────────────────────────
const S = {
  page:    { padding: '24px 28px', fontFamily: 'system-ui,sans-serif', color: '#1e293b', maxWidth: 1280 },
  h1:      { fontSize: 22, fontWeight: 700, margin: 0 },
  tabs:    { display: 'flex', gap: 4, marginTop: 20, marginBottom: 24, borderBottom: '2px solid #e2e8f0' },
  tab:     (a) => ({ padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: a ? '#3b82f6' : '#64748b', borderBottom: a ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: -2 }),
  card:    { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
  btn:     (v = 'primary') => ({ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'success' ? '#22c55e' : v === 'warning' ? '#f59e0b' : '#f1f5f9', color: v === 'ghost' ? '#334155' : '#fff' }),
  input:   { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  select:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td:      { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal:   (w = 620) => ({ background: '#fff', borderRadius: 12, padding: 28, width: w, maxHeight: '90vh', overflowY: 'auto', maxWidth: '96vw' }),
  mh:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  mTitle:  { fontSize: 17, fontWeight: 700, margin: 0 },
  row2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  row3:    { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  fg:      { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:     { fontSize: 12, color: '#64748b' },
  sect:    { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' },
  err:     { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
}

// Orden en formato tarjeta para celular: lo esencial a la vista y las acciones a un toque
function OrdenTarjeta({ o, onAbrir, acciones }) {
  const n = o.estudios?.length ?? 0
  return (
    <div onClick={onAbrir} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.paciente_nombre}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            <span style={{ fontFamily: 'monospace' }}>{o.folio}</span>
            {o.fecha && <> · {o.fecha}</>}
          </div>
        </div>
        <EstadoChip estado={o.estado} map={ESTADO_ORDEN} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
        <div style={{ fontSize: 13, color: '#64748b', minWidth: 0 }}>
          <div>{n} estudio{n !== 1 ? 's' : ''}</div>
          {o.medico_solicitante && <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Dr(a). {o.medico_solicitante}</div>}
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>{fmt(o.total)}</div>
      </div>
      {acciones && (
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
          {acciones}
        </div>
      )}
    </div>
  )
}

const EMPTY_ORDEN = { paciente_id: '', paciente_nombre: '', medico_solicitante: '', fecha: hoy(), observaciones: '', estudios: [] }
const EMPTY_PLANTILLA = { codigo: '', nombre: '', categoria: '', muestra: 'Sangre', tiempo_entrega: 2, precio: '', analitos: [] }
const EMPTY_ANALITO = { nombre: '', unidad: '', tipo: 'numerico', referencia_hombre_min: '', referencia_hombre_max: '', referencia_mujer_min: '', referencia_mujer_max: '', referencia_texto: '' }
const EMPTY_CONFIG = { nombre: '', nombre_corto: '', direccion: '', colonia: '', ciudad: '', estado_rep: '', cp: '', telefono: '', email: '', rfc: '', director: '', cedula_director: '', aviso_pie: '' }

export default function Resultados() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const [vista, setVista] = useState('ordenes')
  const [fechaFiltro, setFechaFiltro] = useState(hoy())
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  // Dashboard
  const [dash, setDash] = useState(null)

  // Órdenes
  const [ordenes, setOrdenes] = useState([])
  const [ordenDetalle, setOrdenDetalle] = useState(null)

  // Plantillas
  const [plantillas, setPlantillas] = useState([])

  // Config del laboratorio
  const [config, setConfig] = useState(EMPTY_CONFIG)
  const [guardandoConfig, setGuardandoConfig] = useState(false)

  // Modales
  const [modalOrden, setModalOrden] = useState(false)
  const [formOrden, setFormOrden] = useState(EMPTY_ORDEN)
  const [guardandoOrden, setGuardandoOrden] = useState(false)

  const [modalPlantilla, setModalPlantilla] = useState(false)
  const [editPlantilla, setEditPlantilla] = useState(null)
  const [formPlantilla, setFormPlantilla] = useState(EMPTY_PLANTILLA)
  const [formAnalito, setFormAnalito] = useState(EMPTY_ANALITO)
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false)

  const [modalCaptura, setModalCaptura] = useState(false)
  const [resultadoEditando, setResultadoEditando] = useState(null)
  const [formCaptura, setFormCaptura] = useState({ analitos: [], observaciones: '', tecnico_nombre: '' })
  const [guardandoCaptura, setGuardandoCaptura] = useState(false)

  const [modalCorreo, setModalCorreo] = useState(null)   // orden a enviar
  const [formCorreo, setFormCorreo] = useState({ email: '', mensaje: '', marcar_entregado: true })
  const [enviandoCorreo, setEnviandoCorreo] = useState(false)
  const [correoConfigurado, setCorreoConfigurado] = useState(true)

  // Búsqueda de paciente (autocomplete)
  const [busquedaPac, setBusquedaPac] = useState('')
  const [sugerencias, setSugerencias] = useState([])
  const busquedaRef = useRef(null)

  // ── Loaders ──────────────────────────────────────────────────────────────

  const cargarDash = useCallback(async () => {
    if (!negocioId) return
    try { setDash(await req(`/api/lab/dashboard?negocio_id=${encodeURIComponent(negocioId)}`)) }
    catch (e) { setError(e.message) }
  }, [negocioId])

  const cargarOrdenes = useCallback(async () => {
    if (!negocioId) return
    setCargando(true); setError('')
    try {
      const params = new URLSearchParams({ negocio_id: negocioId })
      if (fechaFiltro)  params.set('fecha', fechaFiltro)
      if (estadoFiltro) params.set('estado', estadoFiltro)
      if (busqueda)     params.set('busqueda', busqueda)
      setOrdenes(await req(`/api/lab/ordenes?${params}`))
    } catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId, fechaFiltro, estadoFiltro, busqueda])

  const cargarPlantillas = useCallback(async () => {
    if (!negocioId) return
    setCargando(true); setError('')
    try { setPlantillas(await req(`/api/lab/plantillas?negocio_id=${encodeURIComponent(negocioId)}`)) }
    catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId])

  const cargarConfig = useCallback(async () => {
    if (!negocioId) return
    try {
      const data = await req(`/api/lab/config?negocio_id=${encodeURIComponent(negocioId)}`)
      setConfig({ ...EMPTY_CONFIG, ...data })
    } catch (e) { setError(e.message) }
  }, [negocioId])

  const cargarOrdenDetalle = async (id) => {
    try {
      const data = await req(`/api/lab/ordenes/${id}`)
      setOrdenDetalle(data)
    } catch (e) { setError(e.message) }
  }

  async function guardarConfig(ev) {
    ev.preventDefault()
    setGuardandoConfig(true); setError('')
    try {
      await req('/api/lab/config', { method: 'PUT', body: JSON.stringify({ ...config, negocio_id: negocioId }) })
      alert('Configuración guardada correctamente.')
    } catch (e) { setError(e.message) }
    finally { setGuardandoConfig(false) }
  }

  useEffect(() => {
    setError('')
    if (vista === 'resumen')        cargarDash()
    if (vista === 'ordenes')        cargarOrdenes()
    if (vista === 'plantillas')     cargarPlantillas()
    if (vista === 'configuracion')  cargarConfig()
  }, [vista, negocioId])

  useEffect(() => {
    if (vista === 'ordenes') cargarOrdenes()
  }, [fechaFiltro, estadoFiltro, busqueda])

  // ── Buscar pacientes (autocomplete) ──────────────────────────────────────

  useEffect(() => {
    if (!busquedaPac.trim() || busquedaPac.length < 2) { setSugerencias([]); return }
    const t = setTimeout(async () => {
      try {
        const data = await req(`/api/pacientes/pacientes?negocio_id=${encodeURIComponent(negocioId)}&busqueda=${encodeURIComponent(busquedaPac)}&solo_activos=true&limit=8`)
        setSugerencias(Array.isArray(data) ? data : [])
      } catch { setSugerencias([]) }
    }, 300)
    return () => clearTimeout(t)
  }, [busquedaPac, negocioId])

  function seleccionarPaciente(p) {
    setFormOrden(f => ({ ...f, paciente_id: p.id, paciente_nombre: `${p.nombre} ${p.apellido_paterno} ${p.apellido_materno || ''}`.trim() }))
    setBusquedaPac(`${p.nombre} ${p.apellido_paterno}`)
    setSugerencias([])
  }

  // ── Órdenes ──────────────────────────────────────────────────────────────

  async function crearOrden(ev) {
    ev.preventDefault()
    if (!formOrden.paciente_id)        { setError('Selecciona un paciente'); return }
    if (formOrden.estudios.length === 0) { setError('Selecciona al menos un estudio'); return }
    setGuardandoOrden(true); setError('')
    try {
      await req('/api/lab/ordenes', {
        method: 'POST',
        body: JSON.stringify({
          negocio_id:         negocioId,
          paciente_id:        formOrden.paciente_id,
          medico_solicitante: formOrden.medico_solicitante,
          fecha:              formOrden.fecha,
          observaciones:      formOrden.observaciones,
          estudios:           formOrden.estudios.map(id => ({ plantilla_id: id })),
        }),
      })
      setModalOrden(false); setFormOrden(EMPTY_ORDEN); setBusquedaPac('')
      await cargarOrdenes()
      if (vista === 'resumen') cargarDash()
    } catch (e) { setError(e.message) }
    finally { setGuardandoOrden(false) }
  }

  async function cambiarEstadoOrden(id, estado) {
    try {
      await req(`/api/lab/ordenes/${id}/estado?estado=${estado}`, { method: 'PATCH' })
      await cargarOrdenes()
      if (ordenDetalle?.id === id) await cargarOrdenDetalle(id)
    } catch (e) { setError(e.message) }
  }

  function toggleEstudio(pid) {
    setFormOrden(f => ({
      ...f,
      estudios: f.estudios.includes(pid) ? f.estudios.filter(x => x !== pid) : [...f.estudios, pid],
    }))
  }

  // ── Captura de resultados ─────────────────────────────────────────────────

  function abrirCaptura(resultado) {
    setResultadoEditando(resultado)
    setFormCaptura({
      analitos: resultado.analitos.map(a => ({ ...a })),
      observaciones: resultado.observaciones || '',
      tecnico_nombre: resultado.tecnico_nombre || '',
    })
    setError(''); setModalCaptura(true)
  }

  function actualizarValor(idx, valor) {
    setFormCaptura(f => {
      const analitos = f.analitos.map((a, i) => {
        if (i !== idx) return a
        const sexo = ordenDetalle?.paciente_sexo || 'masculino'
        const min = sexo === 'femenino' ? a.referencia_mujer_min : a.referencia_hombre_min
        const max = sexo === 'femenino' ? a.referencia_mujer_max : a.referencia_hombre_max
        return { ...a, valor, flag: calcularFlagJS(valor, a.tipo, min, max) }
      })
      return { ...f, analitos }
    })
  }

  async function guardarCaptura(ev) {
    ev.preventDefault()
    setGuardandoCaptura(true); setError('')
    try {
      await req(`/api/lab/resultados/${resultadoEditando.id}`, {
        method: 'PUT',
        body: JSON.stringify(formCaptura),
      })
      setModalCaptura(false)
      await cargarOrdenDetalle(ordenDetalle.id)
      await cargarOrdenes()
    } catch (e) { setError(e.message) }
    finally { setGuardandoCaptura(false) }
  }

  async function validarResultado(id) {
    const validadoPor = prompt('Nombre del responsable de validación:') ?? ''
    try {
      await req(`/api/lab/resultados/${id}/validar?validado_por=${encodeURIComponent(validadoPor)}`, { method: 'PATCH' })
      await cargarOrdenDetalle(ordenDetalle.id)
      await cargarOrdenes()
    } catch (e) { setError(e.message) }
  }

  // ── Plantillas ────────────────────────────────────────────────────────────

  function abrirNuevaPlantilla() {
    setEditPlantilla(null); setFormPlantilla(EMPTY_PLANTILLA); setFormAnalito(EMPTY_ANALITO)
    setError(''); setModalPlantilla(true)
  }
  function abrirEditarPlantilla(p) {
    setEditPlantilla(p)
    setFormPlantilla({ codigo: p.codigo, nombre: p.nombre, categoria: p.categoria || '', muestra: p.muestra || 'Sangre', tiempo_entrega: p.tiempo_entrega || 2, precio: p.precio || '', analitos: p.analitos ? p.analitos.map(a => ({ ...a })) : [] })
    setFormAnalito(EMPTY_ANALITO); setError(''); setModalPlantilla(true)
  }

  function agregarAnalito() {
    if (!formAnalito.nombre.trim()) return
    setFormPlantilla(f => ({ ...f, analitos: [...f.analitos, { ...formAnalito, referencia_hombre_min: formAnalito.referencia_hombre_min === '' ? null : Number(formAnalito.referencia_hombre_min), referencia_hombre_max: formAnalito.referencia_hombre_max === '' ? null : Number(formAnalito.referencia_hombre_max), referencia_mujer_min: formAnalito.referencia_mujer_min === '' ? null : Number(formAnalito.referencia_mujer_min), referencia_mujer_max: formAnalito.referencia_mujer_max === '' ? null : Number(formAnalito.referencia_mujer_max) }] }))
    setFormAnalito(EMPTY_ANALITO)
  }

  async function guardarPlantilla(ev) {
    ev.preventDefault()
    if (!formPlantilla.codigo.trim() || !formPlantilla.nombre.trim()) { setError('Código y nombre son requeridos'); return }
    setGuardandoPlantilla(true); setError('')
    try {
      const payload = { ...formPlantilla, precio: Number(formPlantilla.precio) || 0, analitos: formPlantilla.analitos }
      if (editPlantilla) {
        await req(`/api/lab/plantillas/${editPlantilla.id}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await req('/api/lab/plantillas', { method: 'POST', body: JSON.stringify({ ...payload, negocio_id: negocioId }) })
      }
      setModalPlantilla(false)
      await cargarPlantillas()
    } catch (e) { setError(e.message) }
    finally { setGuardandoPlantilla(false) }
  }

  // ── Envío por correo ─────────────────────────────────────────────────────

  async function abrirEnvioCorreo(orden) {
    setError('')
    let email = ''
    try {
      const [pac, estado] = await Promise.all([
        req(`/api/pacientes/pacientes/${orden.paciente_id}`),
        req('/api/lab/correo/estado'),
      ])
      email = pac.email || ''
      setCorreoConfigurado(estado.configurado)
    } catch (e) { setError(e.message) }
    setFormCorreo({ email, mensaje: '', marcar_entregado: true })
    setModalCorreo(orden)
  }

  async function enviarCorreo(ev) {
    ev.preventDefault()
    setEnviandoCorreo(true); setError('')
    try {
      await req(`/api/lab/ordenes/${modalCorreo.id}/enviar-correo`, { method: 'POST', body: JSON.stringify(formCorreo) })
      const id = modalCorreo.id
      setModalCorreo(null)
      await cargarOrdenes()
      if (ordenDetalle?.id === id) await cargarOrdenDetalle(id)
      alert(`Resultados enviados a ${formCorreo.email}`)
    } catch (e) { setError(e.message) }
    finally { setEnviandoCorreo(false) }
  }

  async function verPdf(ordenId) {
    try { await abrirPdf(ordenId) }
    catch (e) { setError(e.message) }
  }

  async function eliminarPlantilla(id) {
    if (!window.confirm('¿Eliminar esta plantilla?')) return
    try { await req(`/api/lab/plantillas/${id}`, { method: 'DELETE' }); await cargarPlantillas() }
    catch (e) { setError(e.message) }
  }

  async function cargarEstudiosComunes() {
    if (!window.confirm('¿Cargar los estudios clínicos comunes? Solo se agregarán los que no existan.')) return
    try {
      const r = await req(`/api/lab/plantillas/seed?negocio_id=${encodeURIComponent(negocioId)}`, { method: 'POST' })
      alert(`Estudios cargados: ${r.creados} nuevos de ${r.total_seed} disponibles`)
      await cargarPlantillas()
    } catch (e) { setError(e.message) }
  }

  // ── Totales de orden en modal ─────────────────────────────────────────────
  const totalOrden = plantillas.filter(p => formOrden.estudios.includes(p.id)).reduce((s, p) => s + Number(p.precio || 0), 0)

  // ── Categorías únicas ──────────────────────────────────────────────────────
  const categorias = [...new Set(plantillas.map(p => p.categoria).filter(Boolean))].sort()

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={esMovil ? { ...S.page, padding: 0 } : S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={esMovil ? { ...S.h1, fontSize: 19 } : S.h1}>{esMovil ? 'Resultados' : 'Resultados de Laboratorio'}</h1>
        {!ordenDetalle && (
          <button style={S.btn()} onClick={() => { setFormOrden(EMPTY_ORDEN); setBusquedaPac(''); setError(''); setModalOrden(true) }}>
            + Nueva orden
          </button>
        )}
      </div>

      {!ordenDetalle && (
        <div style={esMovil ? { ...S.tabs, overflowX: 'auto', marginTop: 14, marginBottom: 16, scrollbarWidth: 'none' } : S.tabs}>
          {[['resumen','Resumen del día'],['ordenes','Órdenes'],['plantillas','Catálogo de estudios'],['configuracion','Configuración']].map(([k, l]) => (
            <button key={k} style={esMovil ? { ...S.tab(vista === k), whiteSpace: 'nowrap', padding: '8px 12px', flexShrink: 0 } : S.tab(vista === k)} onClick={() => { setError(''); setVista(k) }}>{l}</button>
          ))}
        </div>
      )}

      {error && <div style={S.err}>{error}</div>}

      {/* ── RESUMEN ─────────────────────────────────────────────────────── */}
      {vista === 'resumen' && !ordenDetalle && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 14 }}>
            {[
              { label: 'Órdenes hoy',      val: dash?.ordenes_hoy     ?? '—', color: '#1e293b' },
              { label: 'Pendientes',        val: dash?.pendientes      ?? '—', color: '#a16207' },
              { label: 'En proceso',        val: dash?.en_proceso      ?? '—', color: '#1d4ed8' },
              { label: 'Completadas hoy',   val: dash?.completadas_hoy ?? '—', color: '#15803d' },
              { label: 'Por entregar',      val: dash?.por_entregar    ?? '—', color: '#7e22ce' },
              { label: 'Ingresos del día',  val: dash ? fmt(dash.ingresos_hoy) : '—', color: '#15803d' },
            ].map(c => (
              <div key={c.label} style={S.card}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.val}</div>
              </div>
            ))}
          </div>

          {dash?.ultimas_ordenes?.length > 0 && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Últimas órdenes</div>
              {esMovil ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dash.ultimas_ordenes.map(o => (
                    <OrdenTarjeta key={o.id} o={o} onAbrir={() => { setVista('ordenes'); cargarOrdenDetalle(o.id) }} />
                  ))}
                </div>
              ) : (
              <table style={S.table}>
                <thead><tr>{['Folio','Paciente','Médico','Estudios','Total','Estado'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {dash.ultimas_ordenes.map(o => (
                    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => { setVista('ordenes'); cargarOrdenDetalle(o.id).then(() => {}) }}>
                      <td style={S.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.folio}</span></td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{o.paciente_nombre}</td>
                      <td style={S.td}>{o.medico_solicitante || '—'}</td>
                      <td style={S.td}>{o.estudios?.length ?? 0}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmt(o.total)}</td>
                      <td style={S.td}><EstadoChip estado={o.estado} map={ESTADO_ORDEN} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ÓRDENES ─────────────────────────────────────────────────────── */}
      {vista === 'ordenes' && !ordenDetalle && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input style={{ ...S.input, maxWidth: esMovil ? 'none' : 200, flex: esMovil ? '1 1 140px' : undefined }} type="date" value={fechaFiltro} onChange={e => setFechaFiltro(e.target.value)} />
            <select style={{ ...S.select, maxWidth: esMovil ? 'none' : 160, flex: esMovil ? '1 1 140px' : undefined }} value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}>
              <option value="">Todos los estados</option>
              {['pendiente','en_proceso','completado','entregado'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
            </select>
            <input style={{ ...S.input, maxWidth: esMovil ? 'none' : 260, flex: esMovil ? '1 1 100%' : undefined }} placeholder="Buscar por folio, paciente o médico…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            <button style={{ ...S.btn('ghost'), marginLeft: 'auto' }} onClick={() => setFechaFiltro('')}>Ver todas</button>
          </div>

          {cargando ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div> : esMovil ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ordenes.length === 0 && (
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
                  Sin órdenes para los filtros seleccionados
                </div>
              )}
              {ordenes.map(o => {
                const listo = ['completado', 'entregado'].includes(o.estado)
                const boton = (v) => ({ ...S.btn(v), flex: 1, padding: '10px 12px', fontSize: 14 })
                return (
                  <OrdenTarjeta key={o.id} o={o} onAbrir={() => cargarOrdenDetalle(o.id)} acciones={listo && <>
                    {o.estado === 'completado' && <button style={boton('primary')} onClick={() => cambiarEstadoOrden(o.id, 'entregado')}>Entregar</button>}
                    <button style={boton('success')} onClick={() => verPdf(o.id)}>PDF</button>
                    <button style={boton('ghost')} onClick={() => abrirEnvioCorreo(o)}>✉ Enviar</button>
                  </>} />
                )
              })}
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={S.table}>
                <thead><tr>{['Folio','Paciente','Fecha','Médico','Estudios','Total','Estado',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {ordenes.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#94a3b8', padding: 40 }}>Sin órdenes para los filtros seleccionados</td></tr>}
                  {ordenes.map(o => (
                    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => cargarOrdenDetalle(o.id)}>
                      <td style={S.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{o.folio}</span></td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{o.paciente_nombre}<div style={{ fontSize: 11, color: '#94a3b8' }}>{o.paciente_folio}</div></td>
                      <td style={S.td}>{o.fecha}</td>
                      <td style={S.td}>{o.medico_solicitante || '—'}</td>
                      <td style={S.td}>{o.estudios?.length ?? 0} estudio{o.estudios?.length !== 1 ? 's' : ''}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmt(o.total)}</td>
                      <td style={S.td}><EstadoChip estado={o.estado} map={ESTADO_ORDEN} /></td>
                      <td style={S.td} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 5 }}>
                          {o.estado === 'completado' && (
                            <button style={S.btn('primary')} onClick={() => cambiarEstadoOrden(o.id, 'entregado')}>Entregar</button>
                          )}
                          {['completado', 'entregado'].includes(o.estado) && (
                            <button style={S.btn('success')} onClick={() => verPdf(o.id)}>
                              PDF
                            </button>
                          )}
                          {['completado', 'entregado'].includes(o.estado) && (
                            <button style={S.btn('ghost')} title="Enviar por correo" onClick={() => abrirEnvioCorreo(o)}>
                              ✉
                            </button>
                          )}
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

      {/* ── DETALLE DE ORDEN ─────────────────────────────────────────────── */}
      {ordenDetalle && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <button style={S.btn('ghost')} onClick={() => { setOrdenDetalle(null); cargarOrdenes() }}>← Volver</button>
            <span style={{ fontFamily: 'monospace', fontSize: 14, color: '#64748b', fontWeight: 700 }}>{ordenDetalle.folio}</span>
            <EstadoChip estado={ordenDetalle.estado} map={ESTADO_ORDEN} />
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {ordenDetalle.estado === 'completado' && (
                <button style={S.btn('primary')} onClick={() => cambiarEstadoOrden(ordenDetalle.id, 'entregado')}>Marcar como entregado</button>
              )}
              {['completado', 'entregado'].includes(ordenDetalle.estado) && (
                <button style={S.btn('success')} onClick={() => verPdf(ordenDetalle.id)}>
                  ↓ Descargar PDF
                </button>
              )}
              {['completado', 'entregado'].includes(ordenDetalle.estado) && (
                <button style={S.btn('primary')} onClick={() => abrirEnvioCorreo(ordenDetalle)}>
                  ✉ Enviar por correo
                </button>
              )}
              {['en_proceso', 'pendiente'].includes(ordenDetalle.estado) && (
                <button style={{ ...S.btn('ghost'), color: '#334155' }} onClick={() => verPdf(ordenDetalle.id)}>
                  Vista previa PDF
                </button>
              )}
            </div>
          </div>

          {/* Cabecera del paciente */}
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, fontSize: 13 }}>
              {[
                ['Paciente', `${ordenDetalle.paciente_nombre} (${ordenDetalle.paciente_folio})`],
                ['Sexo / Edad', `${ordenDetalle.paciente_sexo} · ${ordenDetalle.paciente_edad} años`],
                ['Médico solicitante', ordenDetalle.medico_solicitante || '—'],
                ['Fecha', ordenDetalle.fecha],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {ordenDetalle.observaciones && <div style={{ marginTop: 10, fontSize: 13, color: '#64748b' }}>Obs: {ordenDetalle.observaciones}</div>}
            {ordenDetalle.envios?.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Envíos al paciente</div>
                {[...ordenDetalle.envios].reverse().map((e, i) => (
                  <div key={i} style={{ fontSize: 12, color: e.ok ? '#475569' : '#b91c1c' }}>
                    {e.ok ? '✓' : '✗'} {new Date(e.fecha).toLocaleString('es-MX')} · {e.destinatario}{e.usuario ? ` · por ${e.usuario}` : ''}{!e.ok && e.error ? ` · ${e.error}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resultados por estudio */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(ordenDetalle.resultados || []).map(res => {
              const tieneAnormales = res.analitos?.some(a => ['alto','bajo','critico'].includes(a.flag))
              return (
                <div key={res.id} style={{ ...S.card, borderLeft: `4px solid ${tieneAnormales ? '#f59e0b' : '#e2e8f0'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{res.estudio_nombre}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>{res.estudio_categoria}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <EstadoChip estado={res.estado} map={ESTADO_RES} />
                      {res.estado !== 'validado' && (
                        <button style={S.btn(res.estado === 'pendiente' ? 'primary' : 'warning')} onClick={() => abrirCaptura(res)}>
                          {res.estado === 'pendiente' ? 'Capturar' : 'Editar'}
                        </button>
                      )}
                      {res.estado === 'capturado' && (
                        <button style={S.btn('success')} onClick={() => validarResultado(res.id)}>Validar</button>
                      )}
                    </div>
                  </div>

                  {res.analitos?.length > 0 && res.estado !== 'pendiente' && (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={S.th}>Analito</th>
                          <th style={S.th}>Resultado</th>
                          <th style={S.th}>Unidad</th>
                          <th style={S.th}>Referencia</th>
                          <th style={S.th}>Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {res.analitos.map((a, i) => {
                          const sexo = ordenDetalle.paciente_sexo || 'masculino'
                          const min = sexo === 'femenino' ? a.referencia_mujer_min : a.referencia_hombre_min
                          const max = sexo === 'femenino' ? a.referencia_mujer_max : a.referencia_hombre_max
                          const refStr = a.tipo === 'cualitativo'
                            ? (a.referencia_texto || '—')
                            : (min != null && max != null ? `${min} – ${max}` : '—')
                          return (
                            <tr key={i}>
                              <td style={S.td}>{a.nombre}</td>
                              <td style={{ ...S.td, fontWeight: 700, fontSize: 14 }}>{a.valor || '—'}</td>
                              <td style={S.td}>{a.unidad || '—'}</td>
                              <td style={{ ...S.td, color: '#64748b' }}>{refStr}</td>
                              <td style={S.td}><FlagChip flag={a.flag} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {res.estado === 'validado' && res.validado_por && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>Validado por: {res.validado_por}</div>
                  )}
                  {res.observaciones && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Observaciones: {res.observaciones}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── PLANTILLAS ──────────────────────────────────────────────────── */}
      {vista === 'plantillas' && !ordenDetalle && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, justifyContent: 'flex-end' }}>
            <button style={S.btn('ghost')} onClick={cargarEstudiosComunes}>Cargar estudios comunes</button>
            <button style={S.btn()} onClick={abrirNuevaPlantilla}>+ Nueva plantilla</button>
          </div>

          {categorias.map(cat => (
            <div key={cat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{cat}</div>
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <table style={S.table}>
                  <thead><tr>{['Código','Estudio','Muestra','Tiempo','Precio','Analitos',''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {plantillas.filter(p => p.categoria === cat).map(p => (
                      <tr key={p.id}>
                        <td style={S.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.codigo}</span></td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{p.nombre}</td>
                        <td style={S.td}>{p.muestra}</td>
                        <td style={S.td}>{p.tiempo_entrega}h</td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{fmt(p.precio)}</td>
                        <td style={S.td}>{p.analitos?.length ?? 0}</td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={S.btn('ghost')} onClick={() => abrirEditarPlantilla(p)}>Editar</button>
                            <button style={S.btn('danger')} onClick={() => eliminarPlantilla(p.id)}>Eliminar</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {plantillas.filter(p => !p.categoria).length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={S.table}>
                <tbody>
                  {plantillas.filter(p => !p.categoria).map(p => (
                    <tr key={p.id}>
                      <td style={S.td}>{p.codigo}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{p.nombre}</td>
                      <td style={S.td}>{p.muestra}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmt(p.precio)}</td>
                      <td style={S.td}><button style={S.btn('ghost')} onClick={() => abrirEditarPlantilla(p)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cargando && <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>}
          {!cargando && plantillas.length === 0 && (
            <div style={{ ...S.card, textAlign: 'center', color: '#94a3b8', padding: 40 }}>
              Sin plantillas — usa "Cargar estudios comunes" para empezar rápido.
            </div>
          )}
        </div>
      )}

      {/* ── CONFIGURACIÓN ────────────────────────────────────────────────── */}
      {vista === 'configuracion' && !ordenDetalle && (
        <div style={{ maxWidth: 680 }}>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 0, marginBottom: 20 }}>
            Estos datos aparecen en el encabezado y pie de todos los reportes PDF generados.
          </p>
          {error && <div style={S.err}>{error}</div>}
          <form onSubmit={guardarConfig}>
            <div style={{ ...S.card, display: 'flex', flexDirection: 'column', gap: 0 }}>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Identidad del laboratorio</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={S.fg}>
                  <label style={S.lbl}>Nombre completo *</label>
                  <input style={S.input} placeholder="Ej. Laboratorio de Análisis Clínico Diagnóstico Plus" value={config.nombre} onChange={e => setConfig(c => ({ ...c, nombre: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Nombre corto / siglas</label>
                  <input style={S.input} placeholder="Ej. Lab. Diagnóstico Plus" value={config.nombre_corto} onChange={e => setConfig(c => ({ ...c, nombre_corto: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div style={S.fg}>
                  <label style={S.lbl}>RFC</label>
                  <input style={S.input} value={config.rfc} onChange={e => setConfig(c => ({ ...c, rfc: e.target.value.toUpperCase() }))} maxLength={13} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Correo electrónico</label>
                  <input style={S.input} type="email" value={config.email} onChange={e => setConfig(c => ({ ...c, email: e.target.value }))} />
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 12px' }}>Dirección</div>
              <div style={S.fg}>
                <label style={S.lbl}>Calle y número</label>
                <input style={S.input} placeholder="Ej. Av. Hidalgo 123" value={config.direccion} onChange={e => setConfig(c => ({ ...c, direccion: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
                <div style={S.fg}>
                  <label style={S.lbl}>Colonia</label>
                  <input style={S.input} value={config.colonia} onChange={e => setConfig(c => ({ ...c, colonia: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Ciudad / Municipio</label>
                  <input style={S.input} value={config.ciudad} onChange={e => setConfig(c => ({ ...c, ciudad: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Estado</label>
                  <input style={S.input} value={config.estado_rep} onChange={e => setConfig(c => ({ ...c, estado_rep: e.target.value }))} />
                </div>
              </div>
              <div style={{ ...S.fg, marginTop: 12, maxWidth: 160 }}>
                <label style={S.lbl}>C.P.</label>
                <input style={S.input} value={config.cp} onChange={e => setConfig(c => ({ ...c, cp: e.target.value }))} maxLength={5} />
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 12px' }}>Contacto y firma</div>
              <div style={S.fg}>
                <label style={S.lbl}>Teléfono</label>
                <input style={S.input} value={config.telefono} onChange={e => setConfig(c => ({ ...c, telefono: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <div style={S.fg}>
                  <label style={S.lbl}>Director / Responsable</label>
                  <input style={S.input} placeholder="Q.B.P. Juan Pérez López" value={config.director} onChange={e => setConfig(c => ({ ...c, director: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Cédula profesional</label>
                  <input style={S.input} placeholder="1234567" value={config.cedula_director} onChange={e => setConfig(c => ({ ...c, cedula_director: e.target.value }))} />
                </div>
              </div>

              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '20px 0 12px' }}>Aviso al pie del reporte</div>
              <div style={S.fg}>
                <label style={S.lbl}>Texto del aviso</label>
                <textarea
                  style={{ ...S.input, minHeight: 64, resize: 'vertical' }}
                  placeholder="Ej. Los resultados deben ser interpretados por un médico. Este reporte no tiene validez sin firma autorizada."
                  value={config.aviso_pie}
                  onChange={e => setConfig(c => ({ ...c, aviso_pie: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                <button type="submit" style={S.btn()} disabled={guardandoConfig}>
                  {guardandoConfig ? 'Guardando…' : 'Guardar configuración'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── MODAL NUEVA ORDEN ────────────────────────────────────────────── */}
      {modalOrden && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModalOrden(false)}>
          <div style={S.modal(740)}>
            <div style={S.mh}>
              <h2 style={S.mTitle}>Nueva orden de trabajo</h2>
              <button style={{ ...S.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalOrden(false)}>×</button>
            </div>
            {error && <div style={S.err}>{error}</div>}
            <form onSubmit={crearOrden}>
              {/* Paciente autocomplete */}
              <div style={{ ...S.fg, marginBottom: 12, position: 'relative' }}>
                <label style={S.lbl}>Paciente *</label>
                <input
                  ref={busquedaRef}
                  style={S.input}
                  placeholder="Buscar paciente por nombre o folio…"
                  value={busquedaPac}
                  onChange={e => { setBusquedaPac(e.target.value); setFormOrden(f => ({ ...f, paciente_id: '', paciente_nombre: '' })) }}
                  autoComplete="off"
                />
                {sugerencias.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,.1)', marginTop: 2 }}>
                    {sugerencias.map(p => (
                      <div key={p.id} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f1f5f9' }}
                        onMouseDown={() => seleccionarPaciente(p)}>
                        <span style={{ fontWeight: 600 }}>{p.nombre} {p.apellido_paterno}</span>
                        <span style={{ color: '#94a3b8', marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>{p.folio}</span>
                        {p.fecha_nacimiento && <span style={{ color: '#94a3b8', marginLeft: 8 }}>{p.edad} años · {p.sexo}</span>}
                      </div>
                    ))}
                  </div>
                )}
                {formOrden.paciente_id && <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>✓ Paciente seleccionado</div>}
              </div>

              <div style={S.row3}>
                <div style={S.fg}>
                  <label style={S.lbl}>Médico solicitante</label>
                  <input style={S.input} value={formOrden.medico_solicitante} onChange={e => setFormOrden(f => ({ ...f, medico_solicitante: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Fecha *</label>
                  <input style={S.input} type="date" value={formOrden.fecha} onChange={e => setFormOrden(f => ({ ...f, fecha: e.target.value }))} required />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Observaciones</label>
                  <input style={S.input} value={formOrden.observaciones} onChange={e => setFormOrden(f => ({ ...f, observaciones: e.target.value }))} />
                </div>
              </div>

              {/* Selector de estudios */}
              <div style={{ ...S.sect, marginTop: 20 }}>Estudios a solicitar</div>
              {plantillas.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>No hay plantillas. Ve a "Catálogo de estudios" y carga los estudios comunes.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
                {categorias.map(cat => (
                  <div key={cat}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>{cat}</div>
                    {plantillas.filter(p => p.categoria === cat).map(p => (
                      <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '4px 0', fontSize: 13 }}>
                        <input type="checkbox" checked={formOrden.estudios.includes(p.id)} onChange={() => toggleEstudio(p.id)} />
                        <span style={{ flex: 1 }}>{p.nombre}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>{p.codigo}</span>
                        <span style={{ fontWeight: 600, color: '#15803d' }}>{fmt(p.precio)}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              {formOrden.estudios.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 14, fontWeight: 700 }}>
                  <span>{formOrden.estudios.length} estudio{formOrden.estudios.length !== 1 ? 's' : ''} seleccionado{formOrden.estudios.length !== 1 ? 's' : ''}</span>
                  <span style={{ color: '#15803d' }}>Total: {fmt(totalOrden)}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" style={S.btn('ghost')} onClick={() => setModalOrden(false)}>Cancelar</button>
                <button type="submit" style={S.btn()} disabled={guardandoOrden}>
                  {guardandoOrden ? 'Creando…' : 'Crear orden'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL CAPTURA DE RESULTADOS ──────────────────────────────────── */}
      {modalCaptura && resultadoEditando && (
        <div style={{ ...S.overlay, zIndex: 1100 }} onClick={e => e.target === e.currentTarget && setModalCaptura(false)}>
          <div style={S.modal(700)}>
            <div style={S.mh}>
              <div>
                <h2 style={S.mTitle}>{resultadoEditando.estudio_nombre}</h2>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{resultadoEditando.estudio_categoria}</div>
              </div>
              <button style={{ ...S.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalCaptura(false)}>×</button>
            </div>
            {error && <div style={S.err}>{error}</div>}
            <form onSubmit={guardarCaptura}>
              <div style={{ marginBottom: 16 }}>
                {formCaptura.analitos.map((a, i) => {
                  const sexo = ordenDetalle?.paciente_sexo || 'masculino'
                  const min  = sexo === 'femenino' ? a.referencia_mujer_min : a.referencia_hombre_min
                  const max  = sexo === 'femenino' ? a.referencia_mujer_max : a.referencia_hombre_max
                  const refStr = a.tipo === 'cualitativo' ? (a.referencia_texto || '—') : (min != null && max != null ? `${min} – ${max} ${a.unidad}` : '—')
                  const f = FLAG_STYLE[a.flag] || FLAG_STYLE.pendiente
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{a.nombre}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>Ref: {refStr}</div>
                      </div>
                      <input
                        style={{ ...S.input, border: `1.5px solid ${a.flag === 'critico' ? '#ef4444' : a.flag !== 'normal' && a.flag !== 'pendiente' ? '#f59e0b' : '#cbd5e1'}` }}
                        placeholder={a.tipo === 'cualitativo' ? 'Ej. Negativo' : '0.0'}
                        value={a.valor}
                        onChange={e => actualizarValor(i, e.target.value)}
                        autoFocus={i === 0}
                      />
                      <div style={{ fontSize: 11, color: '#64748b' }}>{a.unidad}</div>
                      <FlagChip flag={a.flag} />
                    </div>
                  )
                })}
              </div>

              <div style={S.row2}>
                <div style={S.fg}>
                  <label style={S.lbl}>Observaciones</label>
                  <input style={S.input} value={formCaptura.observaciones} onChange={e => setFormCaptura(f => ({ ...f, observaciones: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Técnico responsable</label>
                  <input style={S.input} value={formCaptura.tecnico_nombre} onChange={e => setFormCaptura(f => ({ ...f, tecnico_nombre: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button type="button" style={S.btn('ghost')} onClick={() => setModalCaptura(false)}>Cancelar</button>
                <button type="submit" style={S.btn()} disabled={guardandoCaptura}>
                  {guardandoCaptura ? 'Guardando…' : 'Guardar resultados'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL NUEVA / EDITAR PLANTILLA ───────────────────────────────── */}
      {modalPlantilla && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModalPlantilla(false)}>
          <div style={S.modal(740)}>
            <div style={S.mh}>
              <h2 style={S.mTitle}>{editPlantilla ? 'Editar plantilla' : 'Nueva plantilla de estudio'}</h2>
              <button style={{ ...S.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalPlantilla(false)}>×</button>
            </div>
            {error && <div style={S.err}>{error}</div>}
            <form onSubmit={guardarPlantilla}>
              <div style={S.row3}>
                <div style={S.fg}>
                  <label style={S.lbl}>Código *</label>
                  <input style={S.input} value={formPlantilla.codigo} onChange={e => setFormPlantilla(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} required />
                </div>
                <div style={{ ...S.fg, gridColumn: 'span 2' }}>
                  <label style={S.lbl}>Nombre del estudio *</label>
                  <input style={S.input} value={formPlantilla.nombre} onChange={e => setFormPlantilla(f => ({ ...f, nombre: e.target.value }))} required />
                </div>
              </div>
              <div style={{ ...S.row3, marginTop: 12 }}>
                <div style={S.fg}>
                  <label style={S.lbl}>Categoría</label>
                  <input style={S.input} placeholder="Ej. Hematología" value={formPlantilla.categoria} onChange={e => setFormPlantilla(f => ({ ...f, categoria: e.target.value }))} />
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Tipo de muestra</label>
                  <select style={S.select} value={formPlantilla.muestra} onChange={e => setFormPlantilla(f => ({ ...f, muestra: e.target.value }))}>
                    {['Sangre','Orina','Heces','Esputo','Secreción','Otro'].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={S.fg}>
                  <label style={S.lbl}>Precio (MXN)</label>
                  <input style={S.input} type="number" min="0" step="0.01" value={formPlantilla.precio} onChange={e => setFormPlantilla(f => ({ ...f, precio: e.target.value }))} />
                </div>
              </div>

              {/* Analitos */}
              <div style={S.sect}>Analitos</div>
              {formPlantilla.analitos.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                  <span style={{ flex: 2, fontWeight: 600 }}>{a.nombre}</span>
                  <span style={{ flex: 1, color: '#64748b' }}>{a.unidad}</span>
                  <span style={{ flex: 1, color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
                    {a.tipo === 'cualitativo' ? a.referencia_texto : `H: ${a.referencia_hombre_min ?? '?'}–${a.referencia_hombre_max ?? '?'}`}
                  </span>
                  <button type="button" style={{ ...S.btn('danger'), padding: '2px 8px', fontSize: 11 }} onClick={() => setFormPlantilla(f => ({ ...f, analitos: f.analitos.filter((_, j) => j !== i) }))}>×</button>
                </div>
              ))}

              {/* Agregar analito */}
              <div style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: 12, marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#64748b' }}>Agregar analito</div>
                <div style={S.row3}>
                  <div style={S.fg}><label style={S.lbl}>Nombre</label><input style={S.input} value={formAnalito.nombre} onChange={e => setFormAnalito(f => ({ ...f, nombre: e.target.value }))} /></div>
                  <div style={S.fg}><label style={S.lbl}>Unidad</label><input style={S.input} value={formAnalito.unidad} onChange={e => setFormAnalito(f => ({ ...f, unidad: e.target.value }))} /></div>
                  <div style={S.fg}>
                    <label style={S.lbl}>Tipo</label>
                    <select style={S.select} value={formAnalito.tipo} onChange={e => setFormAnalito(f => ({ ...f, tipo: e.target.value }))}>
                      <option value="numerico">Numérico</option>
                      <option value="cualitativo">Cualitativo</option>
                    </select>
                  </div>
                </div>
                {formAnalito.tipo === 'numerico' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
                    {[['Ref. H mín','referencia_hombre_min'],['Ref. H máx','referencia_hombre_max'],['Ref. M mín','referencia_mujer_min'],['Ref. M máx','referencia_mujer_max']].map(([l, k]) => (
                      <div key={k} style={S.fg}><label style={S.lbl}>{l}</label><input style={S.input} type="number" step="any" value={formAnalito[k]} onChange={e => setFormAnalito(f => ({ ...f, [k]: e.target.value }))} /></div>
                    ))}
                  </div>
                ) : (
                  <div style={{ ...S.fg, marginTop: 8 }}><label style={S.lbl}>Valor de referencia</label><input style={S.input} placeholder="Ej. Negativo" value={formAnalito.referencia_texto} onChange={e => setFormAnalito(f => ({ ...f, referencia_texto: e.target.value }))} /></div>
                )}
                <button type="button" style={{ ...S.btn('success'), marginTop: 10 }} onClick={agregarAnalito}>+ Agregar analito</button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button type="button" style={S.btn('ghost')} onClick={() => setModalPlantilla(false)}>Cancelar</button>
                <button type="submit" style={S.btn()} disabled={guardandoPlantilla}>
                  {guardandoPlantilla ? 'Guardando…' : editPlantilla ? 'Guardar cambios' : 'Crear plantilla'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL ENVÍO POR CORREO ─────────────────────────────────────────── */}
      {modalCorreo && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModalCorreo(null)}>
          <div style={S.modal(480)}>
            <div style={S.mh}>
              <h2 style={S.mTitle}>Enviar resultados por correo</h2>
              <button style={{ ...S.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModalCorreo(null)}>×</button>
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
              {modalCorreo.folio} · {modalCorreo.paciente_nombre}. Se adjunta el PDF y un enlace al portal del paciente.
            </div>
            {!correoConfigurado && (
              <div style={S.err}>El servidor no tiene configurado el correo saliente (variables SMTP_*). El envío fallará hasta configurarlo.</div>
            )}
            {error && <div style={S.err}>{error}</div>}
            <form onSubmit={enviarCorreo} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={S.fg}>
                <label style={S.lbl}>Correo del paciente *</label>
                <input style={S.input} type="email" required value={formCorreo.email} onChange={e => setFormCorreo(f => ({ ...f, email: e.target.value }))} placeholder="paciente@correo.com" />
              </div>
              <div style={S.fg}>
                <label style={S.lbl}>Mensaje adicional (opcional)</label>
                <textarea style={{ ...S.input, minHeight: 70, resize: 'vertical' }} value={formCorreo.mensaje} onChange={e => setFormCorreo(f => ({ ...f, mensaje: e.target.value }))} />
              </div>
              {modalCorreo.estado === 'completado' && (
                <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={formCorreo.marcar_entregado} onChange={e => setFormCorreo(f => ({ ...f, marcar_entregado: e.target.checked }))} />
                  Marcar la orden como entregada
                </label>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <button type="button" style={S.btn('ghost')} onClick={() => setModalCorreo(null)}>Cancelar</button>
                <button type="submit" style={S.btn()} disabled={enviandoCorreo}>{enviandoCorreo ? 'Enviando…' : 'Enviar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
