import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, nombreCompleto, s, Campo } from './comun'

const PASOS = ['Datos generales', 'Antecedentes', 'Alergias']

const PACIENTE_VACIO = {
  nombre: '', apellido_paterno: '', apellido_materno: '', fecha_nacimiento: '', sexo: 'masculino',
  curp: '', telefono: '', email: '', direccion: '', ocupacion: '', estado_civil: '',
  contacto_emergencia: { nombre: '', telefono: '', parentesco: '' },
}

const ANTECEDENTES_VACIOS = {
  heredofamiliares: '', patologicos: '', no_patologicos: '', gineco_obstetricos: '',
  alergias: [], medicamentos_actuales: [],
}

const separarAlergias = (texto) => (texto || '').split(/[,;\n]/).map(a => a.trim()).filter(Boolean)

function desde(base, datos) {
  return Object.fromEntries(Object.keys(base).map(k => [k, datos?.[k] ?? base[k]]))
}

// Wizard de 3 pasos para abrir un expediente (paciente nuevo o ya registrado en
// laboratorio) o, con `expediente`, para editar uno existente.
export default function NuevoExpedienteModal({ negocioId, expediente, cerrar, onGuardado }) {
  const editando = Boolean(expediente)
  const [paso, setPaso] = useState(0)
  const [modo, setModo] = useState('nuevo')             // 'nuevo' | 'existente'
  const [paciente, setPaciente] = useState(() => ({
    ...desde(PACIENTE_VACIO, expediente?.paciente),
    contacto_emergencia: { ...PACIENTE_VACIO.contacto_emergencia, ...expediente?.paciente?.contacto_emergencia },
  }))
  const [antecedentes, setAntecedentes] = useState(() => desde(ANTECEDENTES_VACIOS, expediente?.antecedentes))
  const [medicoId, setMedicoId] = useState(expediente?.medico_id || '')
  const [medicos, setMedicos] = useState([])
  const [alergiaNueva, setAlergiaNueva] = useState('')

  const [busqueda, setBusqueda] = useState('')
  const [encontrados, setEncontrados] = useState([])
  const [existente, setExistente] = useState(null)

  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    req(`/api/clinica/medicos?${qs({ negocio_id: negocioId })}`).then(setMedicos).catch(() => setMedicos([]))
  }, [negocioId])

  // Pacientes ya registrados (por ejemplo, en laboratorio) para abrirles expediente
  useEffect(() => {
    if (modo !== 'existente' || !busqueda.trim()) { setEncontrados([]); return }
    const t = setTimeout(() => {
      req(`/api/pacientes/pacientes?${qs({ negocio_id: negocioId, busqueda, limit: 8 })}`)
        .then(setEncontrados).catch(() => setEncontrados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [modo, busqueda, negocioId])

  const setP = (k, v) => setPaciente(p => ({ ...p, [k]: v }))
  const setContacto = (k, v) => setPaciente(p => ({ ...p, contacto_emergencia: { ...p.contacto_emergencia, [k]: v } }))
  const setA = (k, v) => setAntecedentes(a => ({ ...a, [k]: v }))
  const sexo = modo === 'existente' && !editando ? existente?.sexo : paciente.sexo

  function elegirExistente(p) {
    setExistente(p)
    setA('alergias', separarAlergias(p.alergias))
  }

  function agregarAlergia() {
    const nuevas = separarAlergias(alergiaNueva)
      .filter(a => !antecedentes.alergias.some(x => x.toLowerCase() === a.toLowerCase()))
    if (nuevas.length) setA('alergias', [...antecedentes.alergias, ...nuevas])
    setAlergiaNueva('')
  }

  function setMedicamento(i, k, v) {
    setA('medicamentos_actuales', antecedentes.medicamentos_actuales.map((m, j) => j === i ? { ...m, [k]: v } : m))
  }

  function validarPaso() {
    if (paso === 0) {
      if (modo === 'existente' && !editando && !existente) return 'Selecciona un paciente'
      if ((modo === 'nuevo' || editando) && !paciente.nombre.trim()) return 'El nombre es requerido'
    }
    return ''
  }

  async function enviar(ev) {
    ev.preventDefault()
    const problema = validarPaso()
    if (problema) { setError(problema); return }
    setError('')
    if (paso < PASOS.length - 1) { setPaso(paso + 1); return }

    // Una alergia escrita sin presionar "Agregar" también cuenta
    const alergias = [...antecedentes.alergias, ...separarAlergias(alergiaNueva)]
    const datosAntecedentes = {
      ...antecedentes,
      alergias,
      gineco_obstetricos: sexo === 'femenino' ? antecedentes.gineco_obstetricos : '',
      medicamentos_actuales: antecedentes.medicamentos_actuales.filter(m => m.nombre.trim()),
    }
    setGuardando(true)
    try {
      const guardado = editando
        ? await req(`/api/clinica/expedientes/${expediente.id}`, {
            method: 'PUT',
            body: JSON.stringify({ paciente, antecedentes: datosAntecedentes, medico_id: medicoId }),
          })
        : await req('/api/clinica/expedientes', {
            method: 'POST',
            body: JSON.stringify({
              negocio_id: negocioId,
              ...(modo === 'existente' ? { paciente_id: existente.id } : { paciente }),
              antecedentes: datosAntecedentes,
              medico_id: medicoId,
            }),
          })
      onGuardado(guardado)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  const ultimo = paso === PASOS.length - 1

  return (
    <ModalFormulario
      titulo={editando ? `Editar expediente ${expediente.folio}` : 'Nuevo paciente'}
      subtitulo={`Paso ${paso + 1} de ${PASOS.length}: ${PASOS[paso]}`}
      ancho={720}
      error={error}
      cerrar={cerrar}
      onSubmit={enviar}
      guardando={guardando}
      textoGuardar={ultimo ? (editando ? 'Guardar cambios' : 'Crear expediente') : 'Siguiente →'}
    >
      {/* Indicador de pasos; se puede regresar a uno ya visto */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {PASOS.map((nombre, i) => (
          <button key={nombre} type="button" disabled={i > paso} onClick={() => { setError(''); setPaso(i) }} style={{
            flex: 1, padding: '6px 4px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: i < paso ? 'pointer' : 'default',
            background: i === paso ? '#3b82f6' : i < paso ? '#dbeafe' : '#f1f5f9',
            color: i === paso ? '#fff' : i < paso ? '#1d4ed8' : '#94a3b8',
          }}>
            {i + 1}. {nombre}
          </button>
        ))}
      </div>

      {/* ── Paso 1: datos generales ── */}
      {paso === 0 && (
        <>
          {!editando && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[['nuevo', 'Paciente nuevo'], ['existente', 'Ya registrado (laboratorio)']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => { setModo(k); setError('') }}
                  style={{ ...s.btn(modo === k ? 'primary' : 'ghost'), flex: 1 }}>{l}</button>
              ))}
            </div>
          )}

          {modo === 'existente' && !editando ? (
            <div>
              <input style={s.input} autoFocus placeholder="Buscar por nombre, folio o CURP…"
                value={busqueda} onChange={e => setBusqueda(e.target.value)} />
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {encontrados.map(p => (
                  <button key={p.id} type="button" onClick={() => elegirExistente(p)} style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                    border: existente?.id === p.id ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    background: existente?.id === p.id ? '#eff6ff' : '#fff',
                  }}>
                    <div style={{ fontWeight: 600 }}>{nombreCompleto(p)}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      <span style={{ fontFamily: 'monospace' }}>{p.folio}</span>
                      {p.edad ? ` · ${p.edad} años` : ''}{p.curp ? ` · ${p.curp}` : ''}
                    </div>
                  </button>
                ))}
                {busqueda.trim() && encontrados.length === 0 && (
                  <div style={{ fontSize: 13, color: '#94a3b8', padding: 8 }}>Sin coincidencias</div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={s.sect}>Identificación</div>
              <div style={s.grid(180)}>
                <Campo label="Nombre *">
                  <input style={s.input} value={paciente.nombre} onChange={e => setP('nombre', e.target.value)} autoCapitalize="words" required />
                </Campo>
                <Campo label="Apellido paterno">
                  <input style={s.input} value={paciente.apellido_paterno} onChange={e => setP('apellido_paterno', e.target.value)} autoCapitalize="words" />
                </Campo>
                <Campo label="Apellido materno">
                  <input style={s.input} value={paciente.apellido_materno} onChange={e => setP('apellido_materno', e.target.value)} autoCapitalize="words" />
                </Campo>
                <Campo label="Fecha de nacimiento">
                  <input style={s.input} type="date" value={paciente.fecha_nacimiento} onChange={e => setP('fecha_nacimiento', e.target.value)} />
                </Campo>
                <Campo label="Sexo">
                  <select style={s.input} value={paciente.sexo} onChange={e => setP('sexo', e.target.value)}>
                    <option value="masculino">Masculino</option>
                    <option value="femenino">Femenino</option>
                    <option value="otro">Otro</option>
                  </select>
                </Campo>
                <Campo label="CURP">
                  <input style={s.input} value={paciente.curp} maxLength={18} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                    onChange={e => setP('curp', e.target.value.toUpperCase())} />
                </Campo>
                <Campo label="Estado civil">
                  <select style={s.input} value={paciente.estado_civil} onChange={e => setP('estado_civil', e.target.value)}>
                    <option value="">—</option>
                    {['Soltero(a)', 'Casado(a)', 'Unión libre', 'Divorciado(a)', 'Viudo(a)'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </Campo>
                <Campo label="Ocupación">
                  <input style={s.input} value={paciente.ocupacion} onChange={e => setP('ocupacion', e.target.value)} />
                </Campo>
              </div>

              <div style={s.sect}>Contacto</div>
              <div style={s.grid(180)}>
                <Campo label="Teléfono">
                  <input style={s.input} type="tel" value={paciente.telefono} onChange={e => setP('telefono', e.target.value)} />
                </Campo>
                <Campo label="Email">
                  <input style={s.input} type="email" value={paciente.email} onChange={e => setP('email', e.target.value)} autoCapitalize="none" autoCorrect="off" />
                </Campo>
              </div>
              <Campo label="Dirección" style={{ marginTop: 12 }}>
                <input style={s.input} value={paciente.direccion} onChange={e => setP('direccion', e.target.value)} />
              </Campo>

              <div style={s.sect}>Contacto de emergencia</div>
              <div style={s.grid(160)}>
                <Campo label="Nombre">
                  <input style={s.input} value={paciente.contacto_emergencia.nombre} onChange={e => setContacto('nombre', e.target.value)} autoCapitalize="words" />
                </Campo>
                <Campo label="Teléfono">
                  <input style={s.input} type="tel" value={paciente.contacto_emergencia.telefono} onChange={e => setContacto('telefono', e.target.value)} />
                </Campo>
                <Campo label="Parentesco">
                  <input style={s.input} value={paciente.contacto_emergencia.parentesco} onChange={e => setContacto('parentesco', e.target.value)} />
                </Campo>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Paso 2: antecedentes ── */}
      {paso === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Campo label="Heredofamiliares">
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} placeholder="Diabetes, hipertensión, cáncer en familiares…"
              value={antecedentes.heredofamiliares} onChange={e => setA('heredofamiliares', e.target.value)} />
          </Campo>
          <Campo label="Personales patológicos">
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} placeholder="Enfermedades crónicas, cirugías, hospitalizaciones, transfusiones…"
              value={antecedentes.patologicos} onChange={e => setA('patologicos', e.target.value)} />
          </Campo>
          <Campo label="Personales no patológicos">
            <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} placeholder="Tabaquismo, alcoholismo, actividad física, alimentación, vacunas…"
              value={antecedentes.no_patologicos} onChange={e => setA('no_patologicos', e.target.value)} />
          </Campo>
          {sexo === 'femenino' && (
            <Campo label="Gineco-obstétricos">
              <textarea style={{ ...s.input, minHeight: 60, resize: 'vertical' }} placeholder="Menarca, FUM, gestas, partos, cesáreas, abortos, método anticonceptivo…"
                value={antecedentes.gineco_obstetricos} onChange={e => setA('gineco_obstetricos', e.target.value)} />
            </Campo>
          )}

          <div>
            <div style={{ ...s.lbl, marginBottom: 6 }}>Medicamentos actuales</div>
            {antecedentes.medicamentos_actuales.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input style={{ ...s.input, flex: 2 }} placeholder="Medicamento" value={m.nombre} onChange={e => setMedicamento(i, 'nombre', e.target.value)} />
                <input style={{ ...s.input, flex: 1 }} placeholder="Dosis" value={m.dosis} onChange={e => setMedicamento(i, 'dosis', e.target.value)} />
                <button type="button" style={s.btn('ghost')} aria-label="Quitar"
                  onClick={() => setA('medicamentos_actuales', antecedentes.medicamentos_actuales.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" style={s.btn('ghost')}
              onClick={() => setA('medicamentos_actuales', [...antecedentes.medicamentos_actuales, { nombre: '', dosis: '' }])}>
              + Agregar medicamento
            </button>
          </div>
        </div>
      )}

      {/* ── Paso 3: alergias y médico ── */}
      {paso === 2 && (
        <>
          <div style={{ ...s.lbl, marginBottom: 6 }}>Alergias conocidas</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={s.input} placeholder="Ej. Penicilina (separa varias con comas)" value={alergiaNueva}
              onChange={e => setAlergiaNueva(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); agregarAlergia() } }} />
            <button type="button" style={s.btn('ghost')} onClick={agregarAlergia}>Agregar</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, minHeight: 28 }}>
            {antecedentes.alergias.length === 0 && !alergiaNueva.trim() && (
              <span style={{ fontSize: 13, color: '#94a3b8' }}>Sin alergias conocidas</span>
            )}
            {antecedentes.alergias.map(a => (
              <span key={a} style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: 20, padding: '4px 6px 4px 12px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                {a}
                <button type="button" aria-label={`Quitar ${a}`} onClick={() => setA('alergias', antecedentes.alergias.filter(x => x !== a))}
                  style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>

          <div style={s.sect}>Médico tratante</div>
          <select style={s.input} value={medicoId} onChange={e => setMedicoId(e.target.value)}>
            <option value="">Sin asignar</option>
            {medicos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </>
      )}

      {paso > 0 && (
        <button type="button" style={{ ...s.btn('ghost'), marginTop: 16 }} onClick={() => { setError(''); setPaso(paso - 1) }}>
          ← Atrás
        </button>
      )}
    </ModalFormulario>
  )
}
