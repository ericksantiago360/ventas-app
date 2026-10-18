import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import useEsMovil from '../../hooks/useEsMovil'
import NuevoExpedienteModal from './NuevoExpedienteModal'
import NuevoNotaSOAPModal from './NuevoNotaSOAPModal'
import { req, nombreCompleto, fechaHora, s, Chip, SEXO_COLOR, TIPOS_NOTA, BadgeAlergico } from './comun'

const TABS = [['ficha', 'Ficha'], ['notas', 'Notas clínicas'], ['archivos', 'Archivos']]

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

function Nota({ n }) {
  const t = TIPOS_NOTA[n.tipo] || TIPOS_NOTA.seguimiento
  const signos = SIGNOS.filter(([k]) => n.signos_vitales?.[k] !== null && n.signos_vitales?.[k] !== undefined && n.signos_vitales?.[k] !== '')
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Chip texto={t.label} bg={t.bg} color={t.color} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{fechaHora(n.fecha)}</span>
        </div>
        {n.medico_nombre && <span style={{ fontSize: 12, color: '#64748b' }}>Dr(a). {n.medico_nombre}</span>}
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

  // La descarga requiere el token, así que se baja como blob y se abre en otra pestaña
  async function abrir(a) {
    const ventana = window.open('', '_blank')
    try {
      const res = await fetch(`/api/clinica/expedientes/${exp.id}/archivos/${a.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
      if (!res.ok) throw new Error('No se pudo abrir el archivo')
      const url = URL.createObjectURL(await res.blob())
      if (ventana) ventana.location.href = url
      else window.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { ventana?.close(); setError(e.message) }
  }

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

export default function ExpedienteDetalle() {
  const { id } = useParams()
  const navigate = useNavigate()
  const esMovil = useEsMovil()
  const [exp, setExp] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('ficha')
  const [modal, setModal] = useState(null)        // 'editar' | 'nota'

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
            <button style={{ ...s.btn(), flex: esMovil ? 1 : undefined }} onClick={() => setModal('nota')}>+ Nota SOAP</button>
          )}
        </div>
      </div>

      {/* Barra de alertas: siempre a la vista sin importar la pestaña */}
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
            : exp.notas.map(n => <Nota key={n.id} n={n} />)}
        </div>
      )}

      {tab === 'archivos' && <Archivos exp={exp} onSubido={cargar} />}

      {modal === 'editar' && (
        <NuevoExpedienteModal
          negocioId={exp.negocio_id}
          expediente={exp}
          cerrar={() => setModal(null)}
          onGuardado={() => { setModal(null); cargar() }}
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
