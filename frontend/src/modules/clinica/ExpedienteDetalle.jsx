import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useEsMovil from '../../hooks/useEsMovil'
import NuevoExpedienteModal from './NuevoExpedienteModal'
import NuevoNotaSOAPModal from './NuevoNotaSOAPModal'
import NuevaCitaModal from './NuevaCitaModal'
import RecetaModal from './RecetaModal'
import { RecetaFila } from './recetas'
import { req, qs, nombreCompleto, fechaHora, aFecha, abrirArchivo, s, Chip, SEXO_COLOR, TIPOS_NOTA, BadgeAlergico } from './comun'
import { TIPOS_CITA, ChipEstado, AccionesCita } from './citas'
import { ChipsOrden } from './laboratorio'

const TABS = [['ficha', 'Ficha'], ['notas', 'Notas clínicas'], ['recetas', 'Recetas'], ['laboratorio', 'Laboratorio'], ['citas', 'Citas'], ['archivos', 'Archivos']]

const ESTADOS_LAB = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado', entregado: 'Entregado' }

const SIGNOS = [
  ['tension_arterial', 'T/A', 'mmHg'], ['frecuencia_cardiaca', 'FC', 'lpm'], ['temperatura', 'Temp.', '°C'],
  ['peso', 'Peso', 'kg'], ['talla', 'Talla', 'cm'], ['spo2', 'SpO₂', '%'],
]

const tamano = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

function Dato({ label, valor }) {
  return (
    <div>
      <div style={s.kv}>{label}</div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{valor || '—'}</div>
    </div>
  )
}

function Ficha({ exp }) {
  const p = exp.paciente || {}
  const a = exp.antecedentes || {}
  const ce = p.contacto_emergencia || {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={s.card}>
        <div style={{ ...s.sect, marginTop: 0 }}>Datos generales</div>
        <div style={s.grid(170)}>
          <Dato label="Fecha de nacimiento" valor={p.fecha_nacimiento && `${p.fecha_nacimiento}${p.edad ? ` (${p.edad} años)` : ''}`} />
          <Dato label="Sexo" valor={p.sexo} />
          <Dato label="CURP" valor={p.curp} />
          <Dato label="Estado civil" valor={p.estado_civil} />
          <Dato label="Ocupación" valor={p.ocupacion} />
          <Dato label="Teléfono" valor={p.telefono} />
          <Dato label="Email" valor={p.email} />
          <Dato label="Folio de paciente" valor={p.folio} />
        </div>
        <div style={{ marginTop: 12 }}><Dato label="Dirección" valor={p.direccion} /></div>
        <div style={s.sect}>Contacto de emergencia</div>
        <div style={s.grid(170)}>
          <Dato label="Nombre" valor={ce.nombre} />
          <Dato label="Teléfono" valor={ce.telefono || p.telefono_emergencia} />
          <Dato label="Parentesco" valor={ce.parentesco} />
        </div>
      </div>

      <div style={s.card}>
        <div style={{ ...s.sect, marginTop: 0 }}>Alergias</div>
        {a.alergias?.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {a.alergias.map(x => <Chip key={x} texto={x} bg="#fee2e2" color="#b91c1c" />)}
          </div>
        ) : <div style={{ fontSize: 14, color: '#64748b' }}>Sin alergias conocidas</div>}

        <div style={s.sect}>Antecedentes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Dato label="Heredofamiliares" valor={a.heredofamiliares} />
          <Dato label="Personales patológicos" valor={a.patologicos} />
          <Dato label="Personales no patológicos" valor={a.no_patologicos} />
          {p.sexo === 'femenino' && <Dato label="Gineco-obstétricos" valor={a.gineco_obstetricos} />}
        </div>

        <div style={s.sect}>Medicamentos actuales</div>
        {a.medicamentos_actuales?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
            {a.medicamentos_actuales.map((m, i) => <li key={i}>{m.nombre}{m.dosis && <span style={{ color: '#64748b' }}> — {m.dosis}</span>}</li>)}
          </ul>
        ) : <div style={{ fontSize: 14, color: '#64748b' }}>Ninguno</div>}
      </div>
    </div>
  )
}

function Nota({ n, onReceta }) {
  const t = TIPOS_NOTA[n.tipo] || TIPOS_NOTA.seguimiento
  const signos = SIGNOS.filter(([k]) => n.signos_vitales?.[k] !== null && n.signos_vitales?.[k] !== undefined && n.signos_vitales?.[k] !== '')
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chip texto={t.label} bg={t.bg} color={t.color} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{fechaHora(n.fecha)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {n.medico_nombre && <span style={{ fontSize: 12, color: '#64748b' }}>Dr(a). {n.medico_nombre}</span>}
          {onReceta && <button style={{ ...s.btn('ghost'), padding: '5px 10px', fontSize: 12 }} onClick={onReceta}>Generar receta</button>}
        </div>
      </div>

      {signos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {signos.map(([k, label, unidad]) => (
            <span key={k} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 8px', fontSize: 12 }}>
              <span style={{ color: '#94a3b8' }}>{label}</span> <strong>{n.signos_vitales[k]}</strong> {unidad}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {[['subjetivo', 'S'], ['objetivo', 'O'], ['analisis', 'A'], ['plan', 'P']].filter(([k]) => n[k]?.trim()).map(([k, letra]) => (
          <div key={k} style={{ display: 'flex', gap: 10 }}>
            <span style={{ fontWeight: 800, color: '#3b82f6', width: 14, flexShrink: 0 }}>{letra}</span>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{n[k]}</div>
          </div>
        ))}
      </div>

      {n.diagnosticos?.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
          <div style={s.kv}>Diagnósticos</div>
          {n.diagnosticos.map((d, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              {d.cie10 && <span style={{ fontFamily: 'monospace', color: '#64748b', marginRight: 8 }}>{d.cie10}</span>}
              {d.descripcion}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Archivos({ exp, onSubido }) {
  const input = useRef(null)
  const [descripcion, setDescripcion] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  async function subir(archivo) {
    if (!archivo) return
    if (archivo.size > 10 * 1024 * 1024) { setError('El archivo excede 10 MB'); return }
    const datos = new FormData()
    datos.append('archivo', archivo)
    datos.append('descripcion', descripcion)
    setSubiendo(true); setError('')
    try {
      // Sin Content-Type: el navegador pone el boundary del multipart
      const res = await fetch(`/api/clinica/expedientes/${exp.id}/archivos`, {
        method: 'POST', body: datos, headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      const r = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(r.detail || 'No se pudo subir el archivo')
      setDescripcion('')
      onSubido()
    } catch (e) { setError(e.message) }
    finally { setSubiendo(false); if (input.current) input.current.value = '' }
  }

  const abrir = (a) => abrirArchivo(`/api/clinica/expedientes/${exp.id}/archivos/${a.id}`).catch(e => setError(e.message))

  const archivos = [...(exp.archivos || [])].sort((x, y) => (y.fecha > x.fecha ? 1 : -1))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {exp.activo && (
        <div style={{ ...s.card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...s.input, flex: '1 1 220px' }} placeholder="Descripción (opcional): Rx tórax, estudio externo…"
            value={descripcion} onChange={e => setDescripcion(e.target.value)} />
          <input ref={input} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
            onChange={e => subir(e.target.files?.[0])} />
          <button style={s.btn()} disabled={subiendo} onClick={() => input.current?.click()}>
            {subiendo ? 'Subiendo…' : '+ Subir archivo'}
          </button>
          <div style={{ fontSize: 12, color: '#94a3b8', flexBasis: '100%' }}>PDF o imagen, hasta 10 MB.</div>
        </div>
      )}
      {error && <div style={s.err}>{error}</div>}
      {archivos.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin archivos adjuntos</div>
      ) : (
        <div style={{ ...s.card, padding: 0 }}>
          {archivos.map((a, i) => (
            <button key={a.id} onClick={() => abrir(a)} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'none',
              border: 'none', borderTop: i ? '1px solid #f1f5f9' : 'none', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span style={{ background: a.content_type === 'application/pdf' ? '#fee2e2' : '#dbeafe', color: a.content_type === 'application/pdf' ? '#b91c1c' : '#1d4ed8', borderRadius: 6, padding: '4px 6px', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                {a.content_type === 'application/pdf' ? 'PDF' : 'IMG'}
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.descripcion || a.nombre}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: '#94a3b8' }}>
                  {a.descripcion ? `${a.nombre} · ` : ''}{tamano(a.tamano)} · {fechaHora(a.fecha)}{a.subido_por ? ` · ${a.subido_por}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Recetas({ exp, version, onNueva }) {
  const [recetas, setRecetas] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    req(`/api/clinica/recetas?${qs({ negocio_id: exp.negocio_id, expediente_id: exp.id, limit: 200 })}`)
      .then(d => setRecetas(d.items)).catch(e => setError(e.message))
  }, [exp.id, version])

  if (error) return <div style={s.err}>{error}</div>
  if (!recetas) return <div style={{ color: '#94a3b8' }}>Cargando…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {exp.activo && <div><button style={s.btn()} onClick={onNueva}>+ Nueva receta</button></div>}
      {recetas.length === 0
        ? <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin recetas</div>
        : <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
            {recetas.map(r => <RecetaFila key={r.id} r={r} onCambio={(n) => setRecetas(rs => rs.map(x => x.id === n.id ? n : x))} />)}
          </div>}
    </div>
  )
}

// Órdenes de laboratorio del paciente; se abren en la página de resultados
function Laboratorio({ exp }) {
  const navigate = useNavigate()
  const [ordenes, setOrdenes] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    req(`/api/lab/ordenes?${qs({ negocio_id: exp.negocio_id, paciente_id: exp.paciente_id })}`)
      .then(setOrdenes).catch(e => setError(e.message))
  }, [exp.id])

  if (error) return <div style={s.err}>{error}</div>
  if (!ordenes) return <div style={{ color: '#94a3b8' }}>Cargando…</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {exp.activo && <div><button style={s.btn()} onClick={() => navigate(`/resultados?nueva_orden=${exp.id}`)}>+ Solicitar estudios</button></div>}
      {ordenes.length === 0 ? <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin órdenes de laboratorio</div> : (
        <div style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
          {ordenes.map((o, i) => (
            <button key={o.id} onClick={() => navigate(`/resultados?orden=${o.id}`)} style={{
              display: 'block', width: '100%', textAlign: 'left', background: o.resultados_criticos && !o.notificado_medico ? '#fef2f2' : 'none',
              border: 'none', borderTop: i ? '1px solid #f1f5f9' : 'none', padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#64748b' }}>{o.folio}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{o.fecha}</span>
                <Chip texto={ESTADOS_LAB[o.estado] || o.estado} />
                <ChipsOrden o={o} />
              </div>
              <div style={{ fontSize: 13, color: '#334155', marginTop: 3 }}>{(o.estudios || []).map(e => e.nombre).join(' · ')}</div>
              {o.resultados_criticos && (
                <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2, fontWeight: 600 }}>
                  {(o.criticos || []).map(c => `${c.analito}: ${c.valor} ${c.unidad}`).join(' · ')}
                </div>
              )}
              {o.medico_solicitante && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Solicitó: {o.medico_solicitante}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Citas({ exp, version, onReprogramar }) {
  const [citas, setCitas] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    req(`/api/clinica/citas?${qs({ negocio_id: exp.negocio_id, expediente_id: exp.id })}`)
      .then(setCitas).catch(e => setError(e.message))
  }, [exp.id, version])

  if (error) return <div style={s.err}>{error}</div>
  if (!citas) return <div style={{ color: '#94a3b8' }}>Cargando…</div>
  if (!citas.length) return <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Sin citas</div>

  // Próximas primero (la más cercana arriba), después el historial
  const ahora = new Date()
  const proximas = citas.filter(c => aFecha(c.fecha_fin) >= ahora)
  const pasadas = citas.filter(c => aFecha(c.fecha_fin) < ahora).reverse()
  const reemplazar = (n) => setCitas(cs => cs.map(c => c.id === n.id ? n : c))
  const fila = (c) => (
    <div key={c.id} style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{fechaHora(c.fecha_inicio)}</span>
        <ChipEstado estado={c.estado} />
        <span style={{ fontSize: 13, color: '#64748b' }}>
          {[TIPOS_CITA[c.tipo], c.medico_nombre && `Dr(a). ${c.medico_nombre}`, c.consultorio].filter(Boolean).join(' · ')}
        </span>
      </div>
      {c.motivo && <div style={{ fontSize: 13, marginTop: 4 }}>{c.motivo}</div>}
      {aFecha(c.fecha_fin) >= ahora && (
        <div style={{ marginTop: 8 }}><AccionesCita cita={c} onCambio={reemplazar} onReprogramar={() => onReprogramar(c)} compacto /></div>
      )}
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {proximas.length > 0 && <div style={{ ...s.card, padding: 0 }}><div style={{ ...s.sect, margin: '12px 16px 4px' }}>Próximas</div>{proximas.map(fila)}</div>}
      {pasadas.length > 0 && <div style={{ ...s.card, padding: 0 }}><div style={{ ...s.sect, margin: '12px 16px 4px' }}>Historial</div>{pasadas.map(fila)}</div>}
    </div>
  )
}

export default function ExpedienteDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const esMovil = useEsMovil()
  const [exp, setExp] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('ficha')
  const [modal, setModal] = useState(null)        // 'editar' | 'nota' | 'cita' | { cita } | 'receta' | { receta: nota }
  const [versionCitas, setVersionCitas] = useState(0)
  const [versionRecetas, setVersionRecetas] = useState(0)

  const cargar = () => req(`/api/clinica/expedientes/${id}`).then(setExp).catch(e => setError(e.message))
  useEffect(() => { setExp(null); setError(''); cargar() }, [id])

  if (error && !exp) return (
    <div style={s.page}>
      <button style={s.btn('ghost')} onClick={() => navigate('/clinica/expedientes')}>← Expedientes</button>
      <div style={{ ...s.err, marginTop: 16 }}>{error}</div>
    </div>
  )
  if (!exp) return <div style={{ color: '#94a3b8' }}>Cargando…</div>

  const p = exp.paciente || {}
  const sexo = SEXO_COLOR[p.sexo]

  return (
    <div style={s.page}>
      <button style={{ ...s.btn('ghost'), marginBottom: 14 }} onClick={() => navigate('/clinica/expedientes')}>← Expedientes</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={s.h1}>{nombreCompleto(p)}</h1>
            {exp.alergico && <BadgeAlergico alergias={exp.antecedentes.alergias} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 13, color: '#64748b', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace' }}>{exp.folio}</span>
            {p.edad ? <span>· {p.edad} años</span> : null}
            {p.sexo && <Chip texto={p.sexo} bg={sexo?.bg} color={sexo?.color} />}
            {exp.medico_nombre && <span>· Dr(a). {exp.medico_nombre}</span>}
            {!exp.activo && <Chip texto="Cerrado" bg="#fee2e2" color="#b91c1c" />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, width: esMovil ? '100%' : 'auto' }}>
          <button style={{ ...s.btn('ghost'), flex: esMovil ? 1 : undefined }} onClick={() => setModal('editar')}>Editar</button>
          {exp.activo && (
            <button style={{ ...s.btn('ghost'), flex: esMovil ? 1 : undefined }} onClick={() => setModal('cita')}>Agendar cita</button>
          )}
          {exp.activo && (
            <button style={{ ...s.btn(), flex: esMovil ? 1 : undefined }} onClick={() => setModal('nota')}>+ Nota SOAP</button>
          )}
        </div>
      </div>

      {/* Barra de alertas: siempre a la vista sin importar la pestaña */}
      {exp.lab_criticos_pendientes > 0 && (
        <div role="alert" onClick={() => setTab('laboratorio')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#b91c1c', color: '#fff', borderRadius: 8, padding: '10px 14px', marginTop: 16, fontSize: 14, cursor: 'pointer' }}>
          <span style={{ background: '#fff', color: '#b91c1c', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>RESULTADO CRÍTICO</span>
          <span style={{ fontWeight: 600 }}>
            {exp.lab_criticos_pendientes === 1 ? 'Hay una orden de laboratorio' : `Hay ${exp.lab_criticos_pendientes} órdenes de laboratorio`} con resultados críticos sin avisar al médico
          </span>
        </div>
      )}
      {exp.alergico && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginTop: 16, fontSize: 14 }}>
          <BadgeAlergico alergias={exp.antecedentes.alergias} />
          <span style={{ color: '#b91c1c', fontWeight: 600 }}>{exp.antecedentes.alergias.join(', ')}</span>
        </div>
      )}

      <div style={{ ...s.tabs, overflowX: 'auto' }}>
        {TABS.map(([k, l]) => (
          <button key={k} style={s.tab(tab === k)} onClick={() => setTab(k)}>
            {l}
            {k === 'notas' && ` (${exp.notas.length})`}
            {k === 'archivos' && exp.archivos?.length ? ` (${exp.archivos.length})` : ''}
          </button>
        ))}
      </div>

      {error && <div style={s.err}>{error}</div>}

      {tab === 'ficha' && <Ficha exp={exp} />}

      {tab === 'notas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {exp.notas.length === 0
            ? <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>Aún no hay notas clínicas</div>
            : exp.notas.map(n => <Nota key={n.id} n={n} onReceta={exp.activo ? () => setModal({ receta: n }) : null} />)}
        </div>
      )}

      {tab === 'recetas' && <Recetas exp={exp} version={versionRecetas} onNueva={() => setModal('receta')} />}

      {tab === 'laboratorio' && <Laboratorio exp={exp} />}

      {tab === 'citas' && <Citas exp={exp} version={versionCitas} onReprogramar={(c) => setModal({ cita: c })} />}

      {tab === 'archivos' && <Archivos exp={exp} onSubido={cargar} />}

      {modal === 'editar' && (
        <NuevoExpedienteModal
          negocioId={exp.negocio_id}
          expediente={exp}
          cerrar={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
        />
      )}
      {(modal === 'cita' || modal?.cita) && (
        <NuevaCitaModal
          negocioId={exp.negocio_id}
          expediente={exp}
          cita={modal?.cita}
          cerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); setTab('citas'); setVersionCitas(v => v + 1) }}
        />
      )}
      {(modal === 'receta' || modal?.receta) && (
        <RecetaModal
          expediente={exp}
          nota={modal?.receta}
          cerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); setTab('recetas'); setVersionRecetas(v => v + 1) }}
        />
      )}
      {modal === 'nota' && (
        <NuevoNotaSOAPModal
          expediente={exp}
          cerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); setTab('notas'); cargar() }}
        />
      )}
    </div>
  )
}
