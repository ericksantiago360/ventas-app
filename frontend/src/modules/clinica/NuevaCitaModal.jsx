import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, qs, nombreCompleto, hora, diaISO, aFecha, ZONA, s, Campo, BadgeAlergico } from './comun'
import { TIPOS_CITA } from './citas'

const DURACIONES = [15, 20, 30, 45, 60, 90, 120]

const horaLocal = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

// Agendar una cita nueva o, con `cita`, reprogramar una existente.
// `inicio` y `medicoId` prellenan el horario al hacer clic en un hueco del calendario; `dia`, solo la fecha.
// `expediente` fija al paciente (al agendar desde su ficha).
export default function NuevaCitaModal({ negocioId, cita, expediente, inicio, dia, medicoId: medicoInicial, cerrar, onGuardada }) {
  const editando = Boolean(cita)
  const fechaBase = cita ? aFecha(cita.fecha_inicio) : inicio || null

  const [paciente, setPaciente] = useState(cita ? {
    id: cita.expediente_id, folio: cita.expediente_folio, nombre: cita.paciente_nombre, alergias: cita.alergias,
  } : expediente ? {
    id: expediente.id, folio: expediente.folio, nombre: nombreCompleto(expediente.paciente), alergias: expediente.antecedentes?.alergias,
  } : null)
  const [busqueda, setBusqueda] = useState('')
  const [encontrados, setEncontrados] = useState([])

  const [medicos, setMedicos] = useState([])
  const [consultorios, setConsultorios] = useState([])
  const [medicoId, setMedicoId] = useState(cita?.medico_id || medicoInicial || expediente?.medico_id || '')
  const [consultorio, setConsultorio] = useState(cita?.consultorio || '')
  const [fecha, setFecha] = useState(fechaBase ? diaISO(fechaBase) : dia || diaISO(new Date()))
  const [horaInicio, setHoraInicio] = useState(fechaBase ? horaLocal(fechaBase) : '')
  const [duracion, setDuracion] = useState(cita?.duracion_minutos || 30)
  const [tipo, setTipo] = useState(cita?.tipo || 'seguimiento')
  const [motivo, setMotivo] = useState(cita?.motivo || '')
  const [notas, setNotas] = useState(cita?.notas_recepcion || '')

  const [libres, setLibres] = useState(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    req(`/api/clinica/medicos?${qs({ negocio_id: negocioId })}`).then(m => {
      setMedicos(m)
      // Con un solo médico no hay nada que elegir
      if (m.length === 1) setMedicoId(id => id || m[0].id)
    }).catch(() => setMedicos([]))
    req(`/api/clinica/consultorios?${qs({ negocio_id: negocioId })}`).then(setConsultorios).catch(() => setConsultorios([]))
  }, [negocioId])

  useEffect(() => {
    if (paciente || !busqueda.trim()) { setEncontrados([]); return }
    const t = setTimeout(() => {
      req(`/api/clinica/expedientes/buscar?${qs({ negocio_id: negocioId, q: busqueda })}`)
        .then(setEncontrados).catch(() => setEncontrados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda, paciente, negocioId])

  // Horarios libres del médico (y del consultorio) ese día
  useEffect(() => {
    if (!medicoId || !fecha) { setLibres(null); return }
    let vigente = true
    req(`/api/clinica/citas/disponibilidad?${qs({
      negocio_id: negocioId, medico_id: medicoId, fecha, duracion, consultorio: consultorio.trim(), tz: ZONA,
      excluir_id: cita?.id,
    })}`).then(l => { if (vigente) setLibres(l) }).catch(() => { if (vigente) setLibres(null) })
    return () => { vigente = false }
  }, [negocioId, medicoId, fecha, duracion, consultorio, cita?.id])

  async function guardar(ev) {
    ev.preventDefault()
    if (!paciente) { setError('Selecciona un paciente'); return }
    if (!medicoId) { setError('Selecciona un médico'); return }
    if (!horaInicio) { setError('Elige la hora'); return }
    const [a, m, d] = fecha.split('-').map(Number)
    const [h, min] = horaInicio.split(':').map(Number)
    const fechaInicio = new Date(a, m - 1, d, h, min).toISOString()
    const datos = {
      medico_id: medicoId, consultorio, fecha_inicio: fechaInicio, duracion_minutos: Number(duracion),
      tipo, motivo, notas_recepcion: notas,
    }
    setGuardando(true); setError('')
    try {
      const guardada = editando
        ? await req(`/api/clinica/citas/${cita.id}`, { method: 'PUT', body: JSON.stringify(datos) })
        : await req('/api/clinica/citas', {
            method: 'POST', body: JSON.stringify({ ...datos, negocio_id: negocioId, expediente_id: paciente.id }),
          })
      onGuardada(guardada)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario
      titulo={editando ? `Reprogramar ${cita.folio}` : 'Nueva cita'}
      ancho={680}
      error={error}
      cerrar={cerrar}
      onSubmit={guardar}
      guardando={guardando}
      textoGuardar={editando ? 'Guardar cambios' : 'Agendar'}
    >
      <div style={{ ...s.sect, marginTop: 0 }}>Paciente</div>
      {paciente ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>{paciente.nombre}</span>
              {paciente.alergias?.length > 0 && <BadgeAlergico alergias={paciente.alergias} />}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{paciente.folio}</div>
          </div>
          {!editando && !expediente && <button type="button" style={s.btn('ghost')} onClick={() => { setPaciente(null); setBusqueda('') }}>Cambiar</button>}
        </div>
      ) : (
        <>
          <input style={s.input} autoFocus placeholder="Buscar expediente por nombre, folio o CURP…"
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {encontrados.map(e => (
              <button key={e.id} type="button" onClick={() => setPaciente({
                id: e.id, folio: e.folio, nombre: nombreCompleto(e.paciente), alergias: e.antecedentes?.alergias,
              })} style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{nombreCompleto(e.paciente)}</span>
                <span style={{ color: '#94a3b8', fontFamily: 'monospace', marginLeft: 8, fontSize: 12 }}>{e.folio}</span>
                {e.alergico && <span style={{ marginLeft: 8 }}><BadgeAlergico alergias={e.antecedentes.alergias} /></span>}
              </button>
            ))}
            {busqueda.trim() && encontrados.length === 0 && (
              <div style={{ fontSize: 13, color: '#94a3b8', padding: 6 }}>Sin coincidencias. El paciente necesita expediente para agendar.</div>
            )}
          </div>
        </>
      )}

      <div style={s.sect}>Cita</div>
      <div style={s.grid(180)}>
        <Campo label="Médico *">
          <select style={s.input} value={medicoId} onChange={e => setMedicoId(e.target.value)}>
            <option value="">Selecciona…</option>
            {medicos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Consultorio">
          <input style={s.input} list="consultorios-clinica" placeholder="Consultorio 1" value={consultorio} onChange={e => setConsultorio(e.target.value)} />
          <datalist id="consultorios-clinica">{consultorios.map(c => <option key={c} value={c} />)}</datalist>
        </Campo>
        <Campo label="Fecha *">
          <input style={s.input} type="date" value={fecha} onChange={e => setFecha(e.target.value)} required />
        </Campo>
        <Campo label="Duración">
          <select style={s.input} value={duracion} onChange={e => setDuracion(Number(e.target.value))}>
            {[...new Set([...DURACIONES, Number(duracion)])].sort((x, y) => x - y).map(d => <option key={d} value={d}>{d} min</option>)}
          </select>
        </Campo>
      </div>

      <div style={{ ...s.lbl, margin: '14px 0 6px' }}>Hora *</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...s.input, width: 130 }} type="time" step={300} value={horaInicio} onChange={e => setHoraInicio(e.target.value)} />
        {medicoId && libres && <span style={{ fontSize: 12, color: '#64748b' }}>{libres.length ? 'o elige un horario libre:' : 'Sin horarios libres de 8:00 a 20:00'}</span>}
        {!medicoId && <span style={{ fontSize: 12, color: '#94a3b8' }}>Elige un médico para ver sus horarios libres</span>}
      </div>
      {libres?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, maxHeight: 130, overflowY: 'auto' }}>
          {libres.map(l => {
            const h = hora(l.inicio)
            return (
              <button key={l.inicio} type="button" onClick={() => setHoraInicio(h)} style={{
                padding: '5px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontVariantNumeric: 'tabular-nums',
                border: horaInicio === h ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                background: horaInicio === h ? '#eff6ff' : '#fff', color: horaInicio === h ? '#1d4ed8' : '#334155',
              }}>{h}</button>
            )
          })}
        </div>
      )}

      <div style={{ ...s.lbl, margin: '14px 0 6px' }}>Tipo</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(TIPOS_CITA).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTipo(k)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: tipo === k ? '2px solid #3b82f6' : '1px solid #e2e8f0',
            background: tipo === k ? '#eff6ff' : '#fff', color: tipo === k ? '#1d4ed8' : '#64748b',
          }}>{l}</button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        <Campo label="Motivo de consulta">
          <input style={s.input} value={motivo} onChange={e => setMotivo(e.target.value)} />
        </Campo>
        <Campo label="Notas de recepción">
          <textarea style={{ ...s.input, minHeight: 50, resize: 'vertical' }} placeholder="Aseguradora, pago, indicaciones previas…"
            value={notas} onChange={e => setNotas(e.target.value)} />
        </Campo>
      </div>
    </ModalFormulario>
  )
}
