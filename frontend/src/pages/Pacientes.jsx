import { useState, useEffect, useCallback } from 'react'
import { useNegocio } from '../context/NegocioContext'

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

const fmt = (n) => Number(n || 0).toLocaleString('es-MX')

const SEXO_COLOR = {
  masculino: { bg: '#dbeafe', color: '#1d4ed8' },
  femenino:  { bg: '#fce7f3', color: '#9d174d' },
  otro:      { bg: '#f3e8ff', color: '#7e22ce' },
}

const SANGRE_COLOR = { 'A+':'#fee2e2','A-':'#fecaca','B+':'#dbeafe','B-':'#bfdbfe','AB+':'#d1fae5','AB-':'#a7f3d0','O+':'#fef9c3','O-':'#fde68a' }

function Chip({ texto, bg = '#f1f5f9', color = '#475569' }) {
  return <span style={{ background: bg, color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600 }}>{texto}</span>
}

const EMPTY_FORM = {
  nombre: '', apellido_paterno: '', apellido_materno: '',
  fecha_nacimiento: '', sexo: 'masculino', tipo_sangre: 'desconocido',
  curp: '', email: '', telefono: '', telefono_emergencia: '',
  medico_tratante: '', medico_cedula: '', alergias: '', notas: '',
}

export default function Pacientes() {
  const { negocioId } = useNegocio()
  const [vista, setVista] = useState('lista')          // 'lista' | 'resumen' | 'detalle'
  const [pacientes, setPacientes] = useState([])
  const [dash, setDash] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [soloActivos, setSoloActivos] = useState(true)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const [paciente, setPaciente] = useState(null)       // detalle seleccionado

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [guardando, setGuardando] = useState(false)

  // ── Loaders ────────────────────────────────────────────────────────────────

  const cargarPacientes = useCallback(async () => {
    if (!negocioId) return
    setCargando(true); setError('')
    try {
      const data = await req(
        `/api/pacientes/pacientes?negocio_id=${encodeURIComponent(negocioId)}&busqueda=${encodeURIComponent(busqueda)}&solo_activos=${soloActivos}`
      )
      setPacientes(Array.isArray(data) ? data : [])
    } catch (e) { setError(e.message) }
    finally { setCargando(false) }
  }, [negocioId, busqueda, soloActivos])

  const cargarDash = useCallback(async () => {
    if (!negocioId) return
    try {
      const data = await req(`/api/pacientes/pacientes/dashboard/resumen?negocio_id=${encodeURIComponent(negocioId)}`)
      setDash(data)
    } catch (e) { setError(e.message) }
  }, [negocioId])

  useEffect(() => {
    setError('')
    if (vista === 'lista')   cargarPacientes()
    if (vista === 'resumen') cargarDash()
  }, [vista, negocioId])

  useEffect(() => {
    if (vista === 'lista') cargarPacientes()
  }, [busqueda, soloActivos])

  // ── CRUD ───────────────────────────────────────────────────────────────────

  function abrirNuevo() {
    setEditando(null); setForm(EMPTY_FORM); setError(''); setModal(true)
  }

  function abrirEditar(p) {
    setEditando(p)
    setForm({
      nombre: p.nombre || '', apellido_paterno: p.apellido_paterno || '',
      apellido_materno: p.apellido_materno || '', fecha_nacimiento: p.fecha_nacimiento || '',
      sexo: p.sexo || 'masculino', tipo_sangre: p.tipo_sangre || 'desconocido',
      curp: p.curp || '', email: p.email || '', telefono: p.telefono || '',
      telefono_emergencia: p.telefono_emergencia || '', medico_tratante: p.medico_tratante || '',
      medico_cedula: p.medico_cedula || '', alergias: p.alergias || '', notas: p.notas || '',
    })
    setError(''); setModal(true)
  }

  async function guardar(ev) {
    ev.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es requerido'); return }
    setGuardando(true); setError('')
    try {
      if (editando) {
        const updated = await req(`/api/pacientes/pacientes/${editando.id}`, {
          method: 'PUT', body: JSON.stringify(form),
        })
        // Si estamos en detalle, actualizar el paciente visible
        if (vista === 'detalle') setPaciente(updated)
      } else {
        await req('/api/pacientes/pacientes', {
          method: 'POST', body: JSON.stringify({ ...form, negocio_id: negocioId }),
        })
      }
      setModal(false)
      cargarPacientes()
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  async function darDeBaja(id) {
    if (!window.confirm('¿Dar de baja a este paciente?')) return
    try {
      await req(`/api/pacientes/pacientes/${id}`, { method: 'DELETE' })
      if (vista === 'detalle') { setVista('lista') }
      cargarPacientes()
    } catch (e) { setError(e.message) }
  }

  function verDetalle(p) {
    setPaciente(p); setVista('detalle')
  }

  // ── Estilos ────────────────────────────────────────────────────────────────

  const s = {
    page:   { padding: '24px 28px', fontFamily: 'system-ui,sans-serif', color: '#1e293b', maxWidth: 1200 },
    h1:     { fontSize: 22, fontWeight: 700, margin: 0 },
    tabs:   { display: 'flex', gap: 4, marginTop: 20, marginBottom: 24, borderBottom: '2px solid #e2e8f0' },
    tab:    (a) => ({ padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: a ? '#3b82f6' : '#64748b', borderBottom: a ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: -2 }),
    card:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
    grid3:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 },
    kv:     { fontSize: 11, color: '#94a3b8', marginBottom: 3 },
    val:    { fontSize: 22, fontWeight: 700 },
    btn:    (v = 'primary') => ({ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'ghost' ? '#f1f5f9' : '#22c55e', color: v === 'ghost' ? '#334155' : '#fff' }),
    input:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    select: { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
    table:  { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:     { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
    td:     { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
    overlay:{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal:  { background: '#fff', borderRadius: 12, padding: 28, width: 680, maxHeight: '90vh', overflowY: 'auto', maxWidth: '95vw' },
    mh:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    mTitle: { fontSize: 17, fontWeight: 700, margin: 0 },
    row2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
    row3:   { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
    fg:     { display: 'flex', flexDirection: 'column', gap: 4 },
    lbl:    { fontSize: 12, color: '#64748b' },
    sect:   { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' },
    err:    { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={s.h1}>Pacientes</h1>
        {vista !== 'detalle' && (
          <button style={s.btn()} onClick={abrirNuevo}>+ Nuevo paciente</button>
        )}
      </div>

      {vista !== 'detalle' && (
        <div style={s.tabs}>
          {[['resumen','Resumen'],['lista','Lista']].map(([k,l]) => (
            <button key={k} style={s.tab(vista === k)} onClick={() => { setError(''); setVista(k) }}>{l}</button>
          ))}
        </div>
      )}

      {error && <div style={s.err}>{error}</div>}

      {/* ── RESUMEN ─────────────────────────────────────────────────────── */}
      {vista === 'resumen' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={s.grid3}>
            {[
              { label: 'Pacientes activos',  val: fmt(dash?.total_pacientes) },
              { label: 'Nuevos este mes',     val: fmt(dash?.nuevos_este_mes) },
            ].map(c => (
              <div key={c.label} style={s.card}>
                <div style={s.kv}>{c.label}</div>
                <div style={s.val}>{dash ? c.val : '—'}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {/* Por sexo */}
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Por sexo</div>
              {dash?.por_sexo
                ? Object.entries(dash.por_sexo).map(([sexo, cnt]) => {
                    const total = dash.total_pacientes || 1
                    const pct = Math.round((cnt / total) * 100)
                    const col = SEXO_COLOR[sexo] || { bg: '#f1f5f9', color: '#475569' }
                    return (
                      <div key={sexo} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                          <span style={{ textTransform: 'capitalize' }}>{sexo}</span>
                          <span style={{ fontWeight: 700 }}>{cnt} ({pct}%)</span>
                        </div>
                        <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3 }}>
                          <div style={{ height: 6, width: `${pct}%`, background: col.color, borderRadius: 3 }} />
                        </div>
                      </div>
                    )
                  })
                : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sin datos</div>}
            </div>

            {/* Por tipo de sangre */}
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Tipo de sangre</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {dash?.por_sangre && Object.entries(dash.por_sangre)
                  .filter(([k]) => k !== 'desconocido')
                  .sort((a, b) => b[1] - a[1])
                  .map(([tipo, cnt]) => (
                    <div key={tipo} style={{ background: SANGRE_COLOR[tipo] || '#f1f5f9', borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 60 }}>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{tipo}</div>
                      <div style={{ fontSize: 12, color: '#475569' }}>{cnt}</div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Top médicos */}
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Médicos referentes</div>
              {dash?.top_medicos?.length > 0
                ? dash.top_medicos.map(({ medico, pacientes: cnt }) => (
                  <div key={medico} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span>{medico}</span>
                    <span style={{ fontWeight: 700 }}>{cnt}</span>
                  </div>
                ))
                : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sin datos</div>}
            </div>
          </div>

          {/* Últimos registrados */}
          {dash?.ultimos?.length > 0 && (
            <div style={s.card}>
              <div style={{ fontWeight: 700, marginBottom: 12 }}>Últimos registrados</div>
              <table style={s.table}>
                <thead>
                  <tr>{['Folio','Nombre','Edad','Sexo','Médico tratante','Registro'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {dash.ultimos.map(p => (
                    <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(p)}>
                      <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.folio}</span></td>
                      <td style={{ ...s.td, fontWeight: 600 }}>{p.nombre} {p.apellido_paterno}</td>
                      <td style={s.td}>{p.edad ? `${p.edad} años` : '—'}</td>
                      <td style={s.td}><Chip texto={p.sexo} bg={SEXO_COLOR[p.sexo]?.bg} color={SEXO_COLOR[p.sexo]?.color} /></td>
                      <td style={s.td}>{p.medico_tratante || '—'}</td>
                      <td style={{ ...s.td, fontSize: 12, color: '#94a3b8' }}>{p.created_at ? new Date(p.created_at).toLocaleDateString('es-MX') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── LISTA ───────────────────────────────────────────────────────── */}
      {vista === 'lista' && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <input style={{ ...s.input, maxWidth: 300 }} placeholder="Buscar por nombre, folio, CURP o médico…"
              value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
              Solo activos
            </label>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>{pacientes.length} pacientes</span>
          </div>

          {cargando
            ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
            : (
              <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>{['Folio','Nombre','Edad / Sexo','Tipo sangre','Médico tratante','Teléfono','Estado',''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {pacientes.length === 0 && (
                      <tr><td colSpan={8} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 40 }}>Sin pacientes registrados</td></tr>
                    )}
                    {pacientes.map(p => (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(p)}>
                        <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{p.folio}</span></td>
                        <td style={s.td}>
                          <div style={{ fontWeight: 600 }}>{p.nombre} {p.apellido_paterno} {p.apellido_materno}</div>
                          {p.email && <div style={{ fontSize: 11, color: '#94a3b8' }}>{p.email}</div>}
                        </td>
                        <td style={s.td}>
                          <div>{p.edad ? `${p.edad} años` : '—'}</div>
                          <Chip texto={p.sexo} bg={SEXO_COLOR[p.sexo]?.bg} color={SEXO_COLOR[p.sexo]?.color} />
                        </td>
                        <td style={s.td}>
                          {p.tipo_sangre !== 'desconocido'
                            ? <span style={{ background: SANGRE_COLOR[p.tipo_sangre] || '#f1f5f9', borderRadius: 6, padding: '2px 8px', fontWeight: 700, fontSize: 13 }}>{p.tipo_sangre}</span>
                            : <span style={{ color: '#cbd5e1' }}>—</span>}
                        </td>
                        <td style={s.td}>{p.medico_tratante || '—'}</td>
                        <td style={s.td}>{p.telefono || '—'}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: 12, color: p.activo ? '#15803d' : '#94a3b8' }}>
                            {p.activo ? 'Activo' : 'Baja'}
                          </span>
                        </td>
                        <td style={s.td} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button style={s.btn('ghost')} onClick={() => abrirEditar(p)}>Editar</button>
                            {p.activo && <button style={s.btn('danger')} onClick={() => darDeBaja(p.id)}>Baja</button>}
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

      {/* ── DETALLE ─────────────────────────────────────────────────────── */}
      {vista === 'detalle' && paciente && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <button style={s.btn('ghost')} onClick={() => setVista('lista')}>← Volver</button>
            <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#64748b' }}>{paciente.folio}</span>
            <Chip texto={paciente.activo ? 'Activo' : 'Baja'} bg={paciente.activo ? '#dcfce7' : '#f1f5f9'} color={paciente.activo ? '#15803d' : '#94a3b8'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Card principal */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>
                    {paciente.nombre} {paciente.apellido_paterno} {paciente.apellido_materno}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <Chip texto={paciente.sexo} bg={SEXO_COLOR[paciente.sexo]?.bg} color={SEXO_COLOR[paciente.sexo]?.color} />
                    {paciente.tipo_sangre !== 'desconocido' && (
                      <span style={{ background: SANGRE_COLOR[paciente.tipo_sangre] || '#f1f5f9', borderRadius: 6, padding: '2px 10px', fontWeight: 700, fontSize: 12 }}>{paciente.tipo_sangre}</span>
                    )}
                    {paciente.edad > 0 && <Chip texto={`${paciente.edad} años`} />}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={s.btn('ghost')} onClick={() => abrirEditar(paciente)}>Editar</button>
                  {paciente.activo && <button style={s.btn('danger')} onClick={() => darDeBaja(paciente.id)}>Dar de baja</button>}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
                <div>
                  <div style={s.sect}>Datos personales</div>
                  {[
                    ['Fecha nacimiento', paciente.fecha_nacimiento || '—'],
                    ['CURP', paciente.curp || '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <div style={s.kv}>{k}</div>
                      <div style={{ fontSize: 14 }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={s.sect}>Contacto</div>
                  {[
                    ['Teléfono',             paciente.telefono || '—'],
                    ['Tel. emergencia',       paciente.telefono_emergencia || '—'],
                    ['Email',                 paciente.email || '—'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ marginBottom: 8 }}>
                      <div style={s.kv}>{k}</div>
                      <div style={{ fontSize: 14 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Card médico */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={s.card}>
                <div style={s.sect}>Médico tratante</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{paciente.medico_tratante || '—'}</div>
                {paciente.medico_cedula && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Cédula: {paciente.medico_cedula}</div>
                )}
              </div>
              {paciente.alergias && (
                <div style={{ ...s.card, background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>⚠ ALERGIAS</div>
                  <div style={{ fontSize: 13 }}>{paciente.alergias}</div>
                </div>
              )}
              {paciente.notas && (
                <div style={s.card}>
                  <div style={s.sect}>Notas clínicas</div>
                  <div style={{ fontSize: 13 }}>{paciente.notas}</div>
                </div>
              )}
            </div>
          </div>

          {/* Historial de estudios — placeholder hasta módulo Resultados */}
          <div style={{ ...s.card, borderStyle: 'dashed', borderColor: '#cbd5e1' }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Historial de estudios</div>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>
              El historial de resultados estará disponible al implementar el módulo de Resultados.
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL PACIENTE ───────────────────────────────────────────────── */}
      {modal && (
        <div style={s.overlay} onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div style={s.modal}>
            <div style={s.mh}>
              <h2 style={s.mTitle}>{editando ? 'Editar paciente' : 'Nuevo paciente'}</h2>
              <button style={{ ...s.btn('ghost'), fontSize: 18, padding: '2px 10px' }} onClick={() => setModal(false)}>×</button>
            </div>
            {error && <div style={s.err}>{error}</div>}
            <form onSubmit={guardar}>

              <div style={s.sect}>Datos personales</div>
              <div style={s.row3}>
                <div style={s.fg}>
                  <label style={s.lbl}>Nombre *</label>
                  <input style={s.input} value={form.nombre} onChange={e => setF('nombre', e.target.value)} required />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Apellido paterno</label>
                  <input style={s.input} value={form.apellido_paterno} onChange={e => setF('apellido_paterno', e.target.value)} />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Apellido materno</label>
                  <input style={s.input} value={form.apellido_materno} onChange={e => setF('apellido_materno', e.target.value)} />
                </div>
              </div>
              <div style={{ ...s.row3, marginTop: 12 }}>
                <div style={s.fg}>
                  <label style={s.lbl}>Fecha de nacimiento</label>
                  <input style={s.input} type="date" value={form.fecha_nacimiento} onChange={e => setF('fecha_nacimiento', e.target.value)} />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Sexo</label>
                  <select style={s.select} value={form.sexo} onChange={e => setF('sexo', e.target.value)}>
                    <option value="masculino">Masculino</option>
                    <option value="femenino">Femenino</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Tipo de sangre</label>
                  <select style={s.select} value={form.tipo_sangre} onChange={e => setF('tipo_sangre', e.target.value)}>
                    <option value="desconocido">Desconocido</option>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ ...s.fg, marginTop: 12 }}>
                <label style={s.lbl}>CURP</label>
                <input style={s.input} value={form.curp} onChange={e => setF('curp', e.target.value.toUpperCase())} maxLength={18} />
              </div>

              <div style={s.sect}>Contacto</div>
              <div style={s.row3}>
                <div style={s.fg}>
                  <label style={s.lbl}>Teléfono</label>
                  <input style={s.input} value={form.telefono} onChange={e => setF('telefono', e.target.value)} />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Tel. emergencia</label>
                  <input style={s.input} value={form.telefono_emergencia} onChange={e => setF('telefono_emergencia', e.target.value)} />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Email</label>
                  <input style={s.input} type="email" value={form.email} onChange={e => setF('email', e.target.value)} />
                </div>
              </div>

              <div style={s.sect}>Médico tratante</div>
              <div style={s.row2}>
                <div style={s.fg}>
                  <label style={s.lbl}>Nombre del médico</label>
                  <input style={s.input} value={form.medico_tratante} onChange={e => setF('medico_tratante', e.target.value)} />
                </div>
                <div style={s.fg}>
                  <label style={s.lbl}>Cédula profesional</label>
                  <input style={s.input} value={form.medico_cedula} onChange={e => setF('medico_cedula', e.target.value)} />
                </div>
              </div>

              <div style={s.sect}>Notas clínicas</div>
              <div style={s.fg}>
                <label style={s.lbl}>Alergias conocidas</label>
                <input style={s.input} placeholder="Ej. Penicilina, látex…" value={form.alergias} onChange={e => setF('alergias', e.target.value)} />
              </div>
              <div style={{ ...s.fg, marginTop: 10 }}>
                <label style={s.lbl}>Notas adicionales</label>
                <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} value={form.notas} onChange={e => setF('notas', e.target.value)} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
                <button type="button" style={s.btn('ghost')} onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" style={s.btn()} disabled={guardando}>
                  {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar paciente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
