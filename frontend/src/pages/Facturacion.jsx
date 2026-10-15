import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNegocio } from '../context/NegocioContext'

async function req(url, opts = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Error en la solicitud')
  return data
}

async function abrirPdf(id) {
  const token = localStorage.getItem('token')
  const res = await fetch(`/api/facturacion/facturas/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('No se pudo generar el PDF')
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const money = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const hoy = () => new Date().toISOString().slice(0, 10)

const ESTADO = {
  borrador:  { label: 'Borrador',  bg: '#f1f5f9', color: '#475569' },
  emitida:   { label: 'Emitida',   bg: '#dbeafe', color: '#1d4ed8' },
  pagada:    { label: 'Pagada',    bg: '#dcfce7', color: '#15803d' },
  cancelada: { label: 'Cancelada', bg: '#fee2e2', color: '#b91c1c' },
  vencida:   { label: 'Vencida',   bg: '#fef3c7', color: '#b45309' },
}

const ORIGEN = { manual: 'Manual', pedido: 'Pedido', orden_lab: 'Orden lab' }

const FORMAS_PAGO = [
  ['01', 'Efectivo'], ['03', 'Transferencia'], ['04', 'Tarjeta de crédito'],
  ['28', 'Tarjeta de débito'], ['02', 'Cheque'], ['99', 'Por definir'],
]

const USOS_CFDI = [
  ['S01', 'S01 · Sin efectos fiscales'], ['G03', 'G03 · Gastos en general'],
  ['D01', 'D01 · Honorarios médicos y gastos hospitalarios'], ['G01', 'G01 · Adquisición de mercancías'],
  ['CP01', 'CP01 · Pagos'],
]

const IVAS = [[0.16, '16%'], [0.08, '8%'], [0, '0% / Exento']]

const CONCEPTO_VACIO = { descripcion: '', clave: '', unidad: 'Servicio', cantidad: 1, precio_unitario: 0, descuento: 0, iva_tasa: 0.16 }

const FORM_VACIO = {
  receptor: { nombre: '', rfc: 'XAXX010101000', email: '', telefono: '', direccion: '', cp: '', regimen_fiscal: '', uso_cfdi: 'S01' },
  conceptos: [{ ...CONCEPTO_VACIO }],
  descuento_general: 0,
  forma_pago: '01',
  metodo_pago: 'PUE',
  fecha: '',
  dias_credito: 0,
  notas: '',
}

function Chip({ estado, vencida }) {
  const e = vencida ? ESTADO.vencida : (ESTADO[estado] || ESTADO.borrador)
  return <span style={{ background: e.bg, color: e.color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>{e.label}</span>
}

const esVencida = (f) => f.estado === 'emitida' && f.fecha_vencimiento && f.fecha_vencimiento < hoy()

function calcularTotales(conceptos, descuentoGeneral) {
  let subtotal = 0, descuentos = 0, iva = 0
  conceptos.forEach((c) => {
    const bruto = Number(c.cantidad || 0) * Number(c.precio_unitario || 0)
    const desc = Math.min(Number(c.descuento || 0), bruto)
    subtotal += bruto
    descuentos += desc
    iva += (bruto - desc) * Number(c.iva_tasa || 0)
  })
  descuentos += Math.min(Number(descuentoGeneral || 0), subtotal - descuentos)
  return { subtotal, descuentos, iva, total: subtotal - descuentos + iva }
}

export default function Facturacion() {
  const { negocioId } = useNegocio()
  const [vista, setVista] = useState('pendientes')      // 'resumen' | 'pendientes' | 'facturas'
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [cargando, setCargando] = useState(false)

  const [resumen, setResumen] = useState(null)
  const [pendientes, setPendientes] = useState([])
  const [facturas, setFacturas] = useState([])
  const [filtroEstado, setFiltroEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [busquedaPend, setBusquedaPend] = useState('')
  const [procesando, setProcesando] = useState('')     // origen_id en proceso

  const [detalle, setDetalle] = useState(null)
  const [pago, setPago] = useState({ monto: '', forma_pago: '01', fecha: '', referencia: '', cuenta_id: '' })
  const [cuentas, setCuentas] = useState([])

  const [modal, setModal] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)

  // ── Loaders ────────────────────────────────────────────────────────────────

  const cargarResumen = useCallback(async () => {
    try { setResumen(await req(`/api/facturacion/resumen?negocio_id=${encodeURIComponent(negocioId)}`)) }
    catch (e) { setError(e.message) }
  }, [negocioId])

  const cargarPendientes = useCallback(async () => {
    setCargando(true)
    try { setPendientes(await req(`/api/facturacion/pendientes?negocio_id=${encodeURIComponent(negocioId)}`)) }
    catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId])

  const cargarFacturas = useCallback(async () => {
    setCargando(true)
    try {
      const qs = new URLSearchParams({ negocio_id: negocioId, estado: filtroEstado, busqueda })
      setFacturas(await req(`/api/facturacion/facturas?${qs}`))
    } catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId, filtroEstado, busqueda])

  useEffect(() => {
    if (!negocioId) return
    setError('')
    setDetalle(null)
    if (vista === 'resumen') cargarResumen()
    if (vista === 'pendientes') cargarPendientes()
  }, [vista, negocioId])

  useEffect(() => {
    if (!negocioId) return
    setCuentas([])
    req(`/api/finanzas/cuentas?negocio_id=${encodeURIComponent(negocioId)}&activo=true`)
      .then((data) => setCuentas(Array.isArray(data) ? data : []))
      .catch(() => setCuentas([]))
  }, [negocioId])

  useEffect(() => {
    if (negocioId && vista === 'facturas') cargarFacturas()
  }, [vista, negocioId, filtroEstado, busqueda])

  function notificar(msg) {
    setAviso(msg)
    setTimeout(() => setAviso(''), 3500)
  }

  // ── Facturación en un clic ─────────────────────────────────────────────────

  async function facturarOrigen(p, emitir) {
    setProcesando(p.origen_id); setError('')
    try {
      const ruta = p.origen_tipo === 'pedido' ? 'desde-pedido' : 'desde-orden'
      const f = await req(`/api/facturacion/${ruta}/${p.origen_id}?emitir=${emitir}`, { method: 'POST' })
      setPendientes((lista) => lista.filter((x) => x.origen_id !== p.origen_id))
      notificar(emitir ? `Factura ${f.folio} emitida` : `Borrador creado para ${p.folio}`)
      if (!emitir) setDetalle(f)
    } catch (e) { setError(e.message) }
    finally { setProcesando('') }
  }

  // ── Detalle y acciones ─────────────────────────────────────────────────────

  async function verDetalle(id) {
    setError('')
    try {
      setDetalle(await req(`/api/facturacion/facturas/${id}`))
      setPago((p) => ({ ...p, monto: '', fecha: '', referencia: '' }))
    } catch (e) { setError(e.message) }
  }

  async function accion(url, opts, msg) {
    setError('')
    try {
      const f = await req(url, { method: 'POST', ...opts })
      setDetalle(f)
      if (msg) notificar(msg(f))
    } catch (e) { setError(e.message) }
  }

  const emitir = (f) => accion(`/api/facturacion/facturas/${f.id}/emitir`, {}, (r) => `Factura ${r.folio} emitida`)

  function cancelar(f) {
    const motivo = window.prompt(`Motivo de cancelación de ${f.folio}:`)
    if (motivo === null) return
    accion(`/api/facturacion/facturas/${f.id}/cancelar`, { body: JSON.stringify({ motivo }) }, () => 'Factura cancelada')
  }

  async function eliminarBorrador(f) {
    if (!window.confirm('¿Eliminar este borrador?')) return
    try {
      await req(`/api/facturacion/facturas/${f.id}`, { method: 'DELETE' })
      setDetalle(null)
      notificar('Borrador eliminado')
      if (vista === 'facturas') cargarFacturas()
      if (vista === 'pendientes') cargarPendientes()
    } catch (e) { setError(e.message) }
  }

  async function registrarPago(ev) {
    ev.preventDefault()
    const monto = Number(pago.monto)
    if (!monto || monto <= 0) { setError('Captura un monto válido'); return }
    if (!cuentaPago) { setError('Elige la cuenta donde entra el dinero'); return }
    await accion(`/api/facturacion/facturas/${detalle.id}/pagos`, { body: JSON.stringify({ ...pago, monto, cuenta_id: cuentaPago }) }, (r) =>
      r.estado === 'pagada' ? 'Factura liquidada' : `Pago registrado · saldo ${money(r.saldo)}`)
    setPago((p) => ({ ...p, monto: '', fecha: '', referencia: '' }))
  }

  // Cuenta elegida, o la primera activa si aún no se elige ninguna
  const cuentaPago = cuentas.some((c) => c.id === pago.cuenta_id) ? pago.cuenta_id : (cuentas[0]?.id || '')

  async function eliminarPago(p) {
    if (!window.confirm(`¿Eliminar el pago de ${money(p.monto)}? También se cancelará su cobro en Finanzas.`)) return
    setError('')
    try {
      setDetalle(await req(`/api/facturacion/facturas/${detalle.id}/pagos/${p.id}`, { method: 'DELETE' }))
    } catch (e) { setError(e.message) }
  }

  async function pdf(id) {
    try { await abrirPdf(id) } catch (e) { setError(e.message) }
  }

  // ── Formulario ─────────────────────────────────────────────────────────────

  function abrirNueva() {
    setEditandoId(null)
    setForm({ ...FORM_VACIO, receptor: { ...FORM_VACIO.receptor }, conceptos: [{ ...CONCEPTO_VACIO }], fecha: hoy() })
    setError(''); setModal(true)
  }

  function abrirEditar(f) {
    setEditandoId(f.id)
    setForm({
      receptor: { ...FORM_VACIO.receptor, ...f.receptor },
      conceptos: f.conceptos.map((c) => ({ ...CONCEPTO_VACIO, ...c })),
      descuento_general: f.descuento_general || 0,
      forma_pago: f.forma_pago, metodo_pago: f.metodo_pago,
      fecha: f.fecha, dias_credito: f.dias_credito || 0, notas: f.notas || '',
    })
    setError(''); setModal(true)
  }

  const setR = (k, v) => setForm((f) => ({ ...f, receptor: { ...f.receptor, [k]: v } }))
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setC = (i, k, v) => setForm((f) => ({ ...f, conceptos: f.conceptos.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }))
  const agregarConcepto = () => setForm((f) => ({ ...f, conceptos: [...f.conceptos, { ...CONCEPTO_VACIO }] }))
  const quitarConcepto = (i) => setForm((f) => ({ ...f, conceptos: f.conceptos.filter((_, j) => j !== i) }))

  const totalesForm = useMemo(() => calcularTotales(form.conceptos, form.descuento_general), [form.conceptos, form.descuento_general])

  async function guardar(emitirTambien) {
    if (!form.receptor.nombre.trim()) { setError('El nombre del receptor es obligatorio'); return }
    const conceptos = form.conceptos
      .filter((c) => c.descripcion.trim())
      .map((c) => ({ ...c, cantidad: Number(c.cantidad), precio_unitario: Number(c.precio_unitario), descuento: Number(c.descuento || 0), iva_tasa: Number(c.iva_tasa) }))
    if (!conceptos.length) { setError('Agrega al menos un concepto con descripción'); return }

    const body = { ...form, conceptos, descuento_general: Number(form.descuento_general || 0), dias_credito: Number(form.dias_credito || 0) }
    setGuardando(true); setError('')
    try {
      let f
      if (editandoId) {
        f = await req(`/api/facturacion/facturas/${editandoId}`, { method: 'PUT', body: JSON.stringify(body) })
        if (emitirTambien) f = await req(`/api/facturacion/facturas/${editandoId}/emitir`, { method: 'POST' })
      } else {
        f = await req('/api/facturacion/facturas', { method: 'POST', body: JSON.stringify({ ...body, negocio_id: negocioId, emitir: emitirTambien }) })
      }
      setModal(false)
      setDetalle(f)
      notificar(f.folio ? `Factura ${f.folio} emitida` : 'Borrador guardado')
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  // ── Estilos ────────────────────────────────────────────────────────────────

  const s = {
    page:   { padding: '24px 28px', fontFamily: 'system-ui,sans-serif', color: '#1e293b', maxWidth: 1200 },
    h1:     { fontSize: 22, fontWeight: 700, margin: 0 },
    tabs:   { display: 'flex', gap: 4, marginTop: 20, marginBottom: 24, borderBottom: '2px solid #e2e8f0' },
    tab:    (a) => ({ padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: a ? '#3b82f6' : '#64748b', borderBottom: a ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: -2 }),
    card:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
    grid4:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 },
    kv:     { fontSize: 11, color: '#94a3b8', marginBottom: 3 },
    val:    { fontSize: 22, fontWeight: 700 },
    btn:    (v = 'primary') => ({ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'ghost' ? '#f1f5f9' : '#22c55e', color: v === 'ghost' ? '#334155' : '#fff' }),
    input:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    cellIn: { width: '100%', padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 13, boxSizing: 'border-box' },
    table:  { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:     { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
    td:     { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
    num:    { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
    overlay:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:  { background: '#fff', borderRadius: 12, padding: 28, width: 900, maxHeight: '92vh', overflowY: 'auto', maxWidth: '95vw' },
    mh:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    row3:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 },
    fg:     { display: 'flex', flexDirection: 'column', gap: 4 },
    lbl:    { fontSize: 12, color: '#64748b' },
    sect:   { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '18px 0 8px' },
    err:    { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
    ok:     { background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
    empty:  { color: '#94a3b8', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  }

  const pendientesFiltrados = pendientes.filter((p) => {
    const q = busquedaPend.trim().toLowerCase()
    return !q || p.folio.toLowerCase().includes(q) || (p.nombre || '').toLowerCase().includes(q)
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Facturación</h1>
        {!detalle && <button style={s.btn()} onClick={abrirNueva}>+ Nueva factura</button>}
      </div>

      {!detalle && (
        <div style={s.tabs}>
          {[['pendientes', `Por facturar${pendientes.length ? ` (${pendientes.length})` : ''}`], ['facturas', 'Facturas'], ['resumen', 'Resumen']].map(([k, l]) => (
            <button key={k} style={s.tab(vista === k)} onClick={() => setVista(k)}>{l}</button>
          ))}
        </div>
      )}

      {error && <div style={s.err}>{error}</div>}
      {aviso && <div style={s.ok}>{aviso}</div>}

      {/* ── RESUMEN ─────────────────────────────────────────────────────── */}
      {!detalle && vista === 'resumen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={s.grid4}>
            {[
              { label: 'Facturado este mes', val: money(resumen?.facturado_mes), sub: `${resumen?.facturas_mes ?? 0} facturas` },
              { label: 'Cobrado este mes',   val: money(resumen?.cobrado_mes) },
              { label: 'Por cobrar',          val: money(resumen?.por_cobrar), sub: `${resumen?.facturas_abiertas ?? 0} abiertas` },
              { label: 'Vencido',             val: money(resumen?.vencido), sub: `${resumen?.facturas_vencidas ?? 0} vencidas`, alerta: resumen?.facturas_vencidas > 0 },
            ].map((c) => (
              <div key={c.label} style={s.card}>
                <div style={s.kv}>{c.label}</div>
                <div style={{ ...s.val, color: c.alerta ? '#b45309' : '#1e293b' }}>{resumen ? c.val : '—'}</div>
                {c.sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{resumen ? c.sub : ''}</div>}
              </div>
            ))}
          </div>
          <div style={s.card}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Principales receptores</div>
            {resumen?.top_clientes?.length
              ? resumen.top_clientes.map((t) => (
                <div key={t.receptor} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span>{t.receptor} <span style={{ color: '#94a3b8' }}>· {t.facturas} fact.</span></span>
                  <span style={{ fontWeight: 700 }}>{money(t.total)}</span>
                </div>
              ))
              : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sin facturas emitidas</div>}
            {resumen?.borradores > 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>
                Tienes {resumen.borradores} borrador{resumen.borradores !== 1 ? 'es' : ''} sin emitir.{' '}
                <button style={{ ...s.btn('ghost'), padding: '3px 10px' }} onClick={() => { setFiltroEstado('borrador'); setVista('facturas') }}>Ver</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── POR FACTURAR ───────────────────────────────────────────────── */}
      {!detalle && vista === 'pendientes' && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: '#64748b' }}>Pedidos y órdenes de laboratorio sin factura. Factura en un clic.</div>
            <input style={{ ...s.input, maxWidth: 280 }} placeholder="Buscar folio o nombre…" value={busquedaPend} onChange={(e) => setBusquedaPend(e.target.value)} />
          </div>
          {cargando ? <div style={s.empty}>Cargando…</div> : pendientesFiltrados.length === 0 ? (
            <div style={s.empty}>Todo está facturado.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Origen</th><th style={s.th}>Folio</th><th style={s.th}>Fecha</th>
                    <th style={s.th}>Cliente / paciente</th><th style={{ ...s.th, ...s.num }}>Total</th><th style={s.th} />
                  </tr>
                </thead>
                <tbody>
                  {pendientesFiltrados.map((p) => (
                    <tr key={p.origen_id}>
                      <td style={s.td}><span style={{ fontSize: 12, color: '#64748b' }}>{ORIGEN[p.origen_tipo]}</span></td>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 600 }}>{p.folio}</td>
                      <td style={s.td}>{p.fecha}</td>
                      <td style={s.td}>{p.nombre || '—'}</td>
                      <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{money(p.total)}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button style={s.btn('ghost')} disabled={procesando === p.origen_id} onClick={() => facturarOrigen(p, false)}>Revisar</button>
                          <button style={s.btn()} disabled={procesando === p.origen_id} onClick={() => facturarOrigen(p, true)}>
                            {procesando === p.origen_id ? 'Facturando…' : 'Facturar ⚡'}
                          </button>
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

      {/* ── FACTURAS ───────────────────────────────────────────────────── */}
      {!detalle && vista === 'facturas' && (
        <div style={s.card}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['', 'Todas'], ['borrador', 'Borradores'], ['emitida', 'Por cobrar'], ['vencida', 'Vencidas'], ['pagada', 'Pagadas'], ['cancelada', 'Canceladas']].map(([k, l]) => (
              <button key={k} onClick={() => setFiltroEstado(k)}
                style={{ ...s.btn(filtroEstado === k ? 'primary' : 'ghost'), padding: '5px 12px', fontSize: 12 }}>{l}</button>
            ))}
            <input style={{ ...s.input, maxWidth: 280, marginLeft: 'auto' }} placeholder="Folio, receptor, RFC…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
          {cargando ? <div style={s.empty}>Cargando…</div> : facturas.length === 0 ? (
            <div style={s.empty}>Sin facturas.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Folio</th><th style={s.th}>Fecha</th><th style={s.th}>Receptor</th><th style={s.th}>Origen</th>
                    <th style={{ ...s.th, ...s.num }}>Total</th><th style={{ ...s.th, ...s.num }}>Saldo</th><th style={s.th}>Estado</th><th style={s.th} />
                  </tr>
                </thead>
                <tbody>
                  {facturas.map((f) => (
                    <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(f.id)}>
                      <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 600 }}>{f.folio || <span style={{ color: '#94a3b8' }}>—</span>}</td>
                      <td style={s.td}>{f.fecha}</td>
                      <td style={s.td}>
                        <div>{f.receptor?.nombre}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{f.receptor?.rfc}</div>
                      </td>
                      <td style={s.td}><span style={{ fontSize: 12, color: '#64748b' }}>{ORIGEN[f.origen_tipo]}{f.origen_folio ? ` · ${f.origen_folio}` : ''}</span></td>
                      <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{money(f.total)}</td>
                      <td style={{ ...s.td, ...s.num }}>{f.estado === 'emitida' ? money(f.saldo) : '—'}</td>
                      <td style={s.td}><Chip estado={f.estado} vencida={esVencida(f)} /></td>
                      <td style={s.td} onClick={(e) => e.stopPropagation()}>
                        <button style={{ ...s.btn('ghost'), padding: '4px 10px' }} onClick={() => pdf(f.id)}>PDF</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DETALLE ────────────────────────────────────────────────────── */}
      {detalle && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button style={s.btn('ghost')} onClick={() => { setDetalle(null); if (vista === 'facturas') cargarFacturas(); if (vista === 'pendientes') cargarPendientes(); if (vista === 'resumen') cargarResumen() }}>← Volver</button>
            <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700 }}>{detalle.folio || 'Borrador'}</span>
            <Chip estado={detalle.estado} vencida={esVencida(detalle)} />
            {detalle.origen_folio && <span style={{ fontSize: 12, color: '#64748b' }}>{ORIGEN[detalle.origen_tipo]} {detalle.origen_folio}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {detalle.estado === 'borrador' && <>
                <button style={s.btn('ghost')} onClick={() => abrirEditar(detalle)}>Editar</button>
                <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => eliminarBorrador(detalle)}>Eliminar</button>
                <button style={s.btn()} onClick={() => emitir(detalle)}>Emitir factura</button>
              </>}
              {detalle.estado === 'emitida' && !detalle.pagos?.length && (
                <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} onClick={() => cancelar(detalle)}>Cancelar</button>
              )}
              <button style={s.btn('success')} onClick={() => pdf(detalle.id)}>PDF</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <div style={s.card}>
              <div style={s.kv}>Receptor</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{detalle.receptor.nombre}</div>
              <div style={{ fontSize: 13, color: '#475569', marginTop: 4, lineHeight: 1.6 }}>
                RFC {detalle.receptor.rfc} · Uso {detalle.receptor.uso_cfdi}
                {detalle.receptor.email && <><br />{detalle.receptor.email}</>}
                {detalle.receptor.direccion && <><br />{detalle.receptor.direccion}{detalle.receptor.cp ? `, C.P. ${detalle.receptor.cp}` : ''}</>}
              </div>
            </div>
            <div style={s.card}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <div><div style={s.kv}>Fecha</div>{detalle.fecha}</div>
                <div><div style={s.kv}>Vencimiento</div>{detalle.fecha_vencimiento}</div>
                <div><div style={s.kv}>Método</div>{detalle.metodo_pago === 'PUE' ? 'Una sola exhibición' : 'Parcialidades / diferido'}</div>
                <div><div style={s.kv}>Forma</div>{Object.fromEntries(FORMAS_PAGO)[detalle.forma_pago] || detalle.forma_pago}</div>
              </div>
            </div>
          </div>

          <div style={s.card}>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Concepto</th><th style={{ ...s.th, ...s.num }}>Cant.</th><th style={{ ...s.th, ...s.num }}>P. unitario</th>
                    <th style={{ ...s.th, ...s.num }}>Desc.</th><th style={{ ...s.th, ...s.num }}>IVA</th><th style={{ ...s.th, ...s.num }}>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.conceptos.map((c, i) => (
                    <tr key={i}>
                      <td style={s.td}>{c.descripcion}{c.clave && <span style={{ color: '#94a3b8', fontSize: 11 }}> · {c.clave}</span>}</td>
                      <td style={{ ...s.td, ...s.num }}>{c.cantidad}</td>
                      <td style={{ ...s.td, ...s.num }}>{money(c.precio_unitario)}</td>
                      <td style={{ ...s.td, ...s.num }}>{c.descuento ? money(c.descuento) : '—'}</td>
                      <td style={{ ...s.td, ...s.num }}>{Math.round(c.iva_tasa * 100)}%</td>
                      <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{money(c.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <div style={{ minWidth: 240, fontSize: 13 }}>
                {[['Subtotal', detalle.subtotal], detalle.descuento ? ['Descuento', -detalle.descuento] : null, ['IVA', detalle.iva]].filter(Boolean).map(([l, v]) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#64748b' }}>{l}</span><span>{money(v)}</span></div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #1e293b', marginTop: 4, fontWeight: 700, fontSize: 15 }}>
                  <span>Total</span><span>{money(detalle.total)}</span>
                </div>
              </div>
            </div>
            {detalle.notas && <div style={{ marginTop: 10, fontSize: 13, color: '#475569' }}><b>Notas:</b> {detalle.notas}</div>}
            {detalle.estado === 'cancelada' && <div style={{ ...s.err, marginTop: 12, marginBottom: 0 }}>Cancelada{detalle.motivo_cancelacion ? `: ${detalle.motivo_cancelacion}` : ''}</div>}
          </div>

          {['emitida', 'pagada'].includes(detalle.estado) && (
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>Pagos</div>
                <div style={{ fontSize: 13 }}>Pagado <b>{money(detalle.total_pagado)}</b> · Saldo <b style={{ color: detalle.saldo > 0 ? '#b45309' : '#15803d' }}>{money(detalle.saldo)}</b></div>
              </div>
              {detalle.pagos?.length > 0 && (
                <table style={{ ...s.table, marginBottom: 12 }}>
                  <tbody>
                    {detalle.pagos.map((p) => (
                      <tr key={p.id}>
                        <td style={s.td}>{p.fecha}</td>
                        <td style={s.td}>{Object.fromEntries(FORMAS_PAGO)[p.forma_pago] || p.forma_pago}</td>
                        <td style={s.td}>
                          {p.cuenta_nombre || '—'}
                          {p.cobro_numero && <div style={{ fontSize: 11, color: '#94a3b8' }}>Cobro {p.cobro_numero}</div>}
                          {p.poliza_error && <div style={{ fontSize: 11, color: '#b45309' }} title={p.poliza_error}>Sin póliza contable</div>}
                        </td>
                        <td style={{ ...s.td, color: '#64748b' }}>{p.referencia}</td>
                        <td style={{ ...s.td, ...s.num, fontWeight: 600 }}>{money(p.monto)}</td>
                        <td style={{ ...s.td, width: 40 }}>
                          <button style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }} title="Eliminar pago" onClick={() => eliminarPago(p)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {detalle.estado === 'emitida' && cuentas.length === 0 && (
                <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', borderRadius: 6, padding: '8px 12px' }}>
                  Para registrar pagos crea primero una cuenta (caja o banco) en Finanzas.
                </div>
              )}
              {detalle.estado === 'emitida' && cuentas.length > 0 && (
                <form onSubmit={registrarPago} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ ...s.fg, width: 140 }}>
                    <label style={s.lbl}>Monto</label>
                    <input style={s.input} type="number" step="0.01" min="0" value={pago.monto} onChange={(e) => setPago({ ...pago, monto: e.target.value })} />
                  </div>
                  <div style={{ ...s.fg, width: 170 }}>
                    <label style={s.lbl}>Cuenta destino</label>
                    <select style={s.input} value={cuentaPago} onChange={(e) => setPago({ ...pago, cuenta_id: e.target.value })}>
                      {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div style={{ ...s.fg, width: 170 }}>
                    <label style={s.lbl}>Forma</label>
                    <select style={s.input} value={pago.forma_pago} onChange={(e) => setPago({ ...pago, forma_pago: e.target.value })}>
                      {FORMAS_PAGO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div style={{ ...s.fg, width: 150 }}>
                    <label style={s.lbl}>Fecha</label>
                    <input style={s.input} type="date" value={pago.fecha} onChange={(e) => setPago({ ...pago, fecha: e.target.value })} />
                  </div>
                  <div style={{ ...s.fg, flex: 1, minWidth: 140 }}>
                    <label style={s.lbl}>Referencia</label>
                    <input style={s.input} value={pago.referencia} onChange={(e) => setPago({ ...pago, referencia: e.target.value })} />
                  </div>
                  <button type="button" style={s.btn('ghost')} onClick={() => setPago({ ...pago, monto: String(detalle.saldo) })}>Saldo total</button>
                  <button type="submit" style={s.btn('success')}>Registrar pago</button>
                </form>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL FACTURA ──────────────────────────────────────────────── */}
      {modal && (
        <div style={s.overlay} onClick={() => !guardando && setModal(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <div style={s.mh}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{editandoId ? 'Editar borrador' : 'Nueva factura'}</h2>
              <button style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }} onClick={() => setModal(false)}>✕</button>
            </div>
            {error && <div style={s.err}>{error}</div>}

            <div style={{ ...s.sect, marginTop: 0 }}>Receptor</div>
            <div style={s.row3}>
              <div style={{ ...s.fg, gridColumn: 'span 2' }}>
                <label style={s.lbl}>Nombre / razón social *</label>
                <input style={s.input} value={form.receptor.nombre} onChange={(e) => setR('nombre', e.target.value)} autoFocus />
              </div>
              <div style={s.fg}>
                <label style={s.lbl}>RFC</label>
                <input style={s.input} value={form.receptor.rfc} onChange={(e) => setR('rfc', e.target.value.toUpperCase())} maxLength={13} />
              </div>
              <div style={s.fg}>
                <label style={s.lbl}>Email</label>
                <input style={s.input} type="email" value={form.receptor.email} onChange={(e) => setR('email', e.target.value)} />
              </div>
              <div style={s.fg}>
                <label style={s.lbl}>Código postal</label>
                <input style={s.input} value={form.receptor.cp} onChange={(e) => setR('cp', e.target.value)} maxLength={5} />
              </div>
              <div style={s.fg}>
                <label style={s.lbl}>Uso CFDI</label>
                <select style={s.input} value={form.receptor.uso_cfdi} onChange={(e) => setR('uso_cfdi', e.target.value)}>
                  {USOS_CFDI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>

            <div style={s.sect}>Conceptos</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={{ ...s.th, minWidth: 220 }}>Descripción</th><th style={{ ...s.th, width: 70 }}>Cant.</th>
                    <th style={{ ...s.th, width: 110 }}>Precio</th><th style={{ ...s.th, width: 90 }}>Desc.</th>
                    <th style={{ ...s.th, width: 110 }}>IVA</th><th style={{ ...s.th, ...s.num, width: 110 }}>Importe</th><th style={{ ...s.th, width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {form.conceptos.map((c, i) => (
                    <tr key={i}>
                      <td style={{ padding: '4px 4px 4px 0' }}><input style={s.cellIn} value={c.descripcion} placeholder="Producto o servicio" onChange={(e) => setC(i, 'descripcion', e.target.value)} /></td>
                      <td style={{ padding: 4 }}><input style={s.cellIn} type="number" min="0" step="any" value={c.cantidad} onChange={(e) => setC(i, 'cantidad', e.target.value)} /></td>
                      <td style={{ padding: 4 }}><input style={s.cellIn} type="number" min="0" step="0.01" value={c.precio_unitario} onChange={(e) => setC(i, 'precio_unitario', e.target.value)} /></td>
                      <td style={{ padding: 4 }}><input style={s.cellIn} type="number" min="0" step="0.01" value={c.descuento} onChange={(e) => setC(i, 'descuento', e.target.value)} /></td>
                      <td style={{ padding: 4 }}>
                        <select style={s.cellIn} value={c.iva_tasa} onChange={(e) => setC(i, 'iva_tasa', Number(e.target.value))}>
                          {IVAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: 4, ...s.num }}>{money(Number(c.cantidad || 0) * Number(c.precio_unitario || 0) - Number(c.descuento || 0))}</td>
                      <td style={{ padding: 4 }}>
                        {form.conceptos.length > 1 && <button style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }} onClick={() => quitarConcepto(i)}>✕</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button style={{ ...s.btn('ghost'), marginTop: 8 }} onClick={agregarConcepto}>+ Agregar concepto</button>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, marginTop: 4 }}>
              <div>
                <div style={s.sect}>Pago</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={s.fg}>
                    <label style={s.lbl}>Método</label>
                    <select style={s.input} value={form.metodo_pago} onChange={(e) => setF('metodo_pago', e.target.value)}>
                      <option value="PUE">PUE · Una exhibición</option>
                      <option value="PPD">PPD · Parcialidades</option>
                    </select>
                  </div>
                  <div style={s.fg}>
                    <label style={s.lbl}>Forma</label>
                    <select style={s.input} value={form.forma_pago} onChange={(e) => setF('forma_pago', e.target.value)}>
                      {FORMAS_PAGO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div style={s.fg}>
                    <label style={s.lbl}>Fecha</label>
                    <input style={s.input} type="date" value={form.fecha} onChange={(e) => setF('fecha', e.target.value)} />
                  </div>
                  <div style={s.fg}>
                    <label style={s.lbl}>Días de crédito</label>
                    <input style={s.input} type="number" min="0" max="365" value={form.dias_credito} onChange={(e) => setF('dias_credito', e.target.value)} />
                  </div>
                </div>
                <div style={{ ...s.fg, marginTop: 12 }}>
                  <label style={s.lbl}>Notas</label>
                  <textarea style={{ ...s.input, minHeight: 56, resize: 'vertical' }} value={form.notas} onChange={(e) => setF('notas', e.target.value)} />
                </div>
              </div>
              <div>
                <div style={s.sect}>Totales</div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 16px', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#64748b' }}>Subtotal</span><span>{money(totalesForm.subtotal)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                    <span style={{ color: '#64748b' }}>Descuento general</span>
                    <input style={{ ...s.cellIn, width: 100, textAlign: 'right' }} type="number" min="0" step="0.01" value={form.descuento_general} onChange={(e) => setF('descuento_general', e.target.value)} />
                  </div>
                  {totalesForm.descuentos > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#64748b' }}>Descuentos</span><span>-{money(totalesForm.descuentos)}</span></div>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}><span style={{ color: '#64748b' }}>IVA</span><span>{money(totalesForm.iva)}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 2px', borderTop: '1px solid #cbd5e1', marginTop: 6, fontWeight: 700, fontSize: 16 }}><span>Total</span><span>{money(totalesForm.total)}</span></div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button style={s.btn('ghost')} disabled={guardando} onClick={() => setModal(false)}>Cancelar</button>
              <button style={s.btn('ghost')} disabled={guardando} onClick={() => guardar(false)}>Guardar borrador</button>
              <button style={s.btn()} disabled={guardando} onClick={() => guardar(true)}>{guardando ? 'Guardando…' : 'Guardar y emitir'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
