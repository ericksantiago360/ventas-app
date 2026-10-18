import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import useEsMovil from '../../hooks/useEsMovil'
import PerfilMedicoModal from './PerfilMedicoModal'
import { req, s, Campo, BadgeAlergico } from './comun'

const VIAS = ['oral', 'sublingual', 'tópica', 'oftálmica', 'ótica', 'nasal', 'inhalada', 'rectal', 'vaginal', 'IM', 'IV', 'subcutánea']

const MED_VACIO = { nombre: '', presentacion: '', dosis: '', frecuencia: '', duracion: '', via: 'oral', indicaciones: '' }

const dxDeNota = (nota) => (nota?.diagnosticos || [])
  .map(d => [d.cie10, d.descripcion].filter(Boolean).join(' ')).join('; ')

// Receta para el paciente del expediente; con `nota`, queda vinculada a esa consulta
export default function RecetaModal({ expediente, nota, cerrar, onGuardada }) {
  const esMovil = useEsMovil()
  const [perfil, setPerfil] = useState(null)
  const [editarPerfil, setEditarPerfil] = useState(false)
  const [medicamentos, setMedicamentos] = useState([{ ...MED_VACIO }])
  const [diagnostico, setDiagnostico] = useState(dxDeNota(nota))
  const [indicaciones, setIndicaciones] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { req('/api/clinica/perfil-medico').then(setPerfil).catch(e => setError(e.message)) }, [])

  const alergias = expediente.antecedentes?.alergias || []
  const sinCedula = perfil && !perfil.cedula_profesional

  const setMed = (i, k, v) => setMedicamentos(ms => ms.map((m, j) => j === i ? { ...m, [k]: v } : m))
  const quitar = (i) => setMedicamentos(ms => ms.length > 1 ? ms.filter((_, j) => j !== i) : [{ ...MED_VACIO }])

  async function guardar(ev) {
    ev.preventDefault()
    if (sinCedula) { setEditarPerfil(true); return }
    const lista = medicamentos.filter(m => m.nombre.trim())
    if (!lista.length) { setError('Agrega al menos un medicamento'); return }
    setGuardando(true); setError('')
    try {
      const receta = await req('/api/clinica/recetas', {
        method: 'POST',
        body: JSON.stringify({
          expediente_id: expediente.id, nota_clinica_id: nota?.id || '',
          medicamentos: lista, diagnostico, indicaciones_generales: indicaciones,
        }),
      })
      onGuardada(receta)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  if (editarPerfil) {
    return <PerfilMedicoModal cerrar={() => setEditarPerfil(false)} onGuardado={(p) => { setPerfil(p); setEditarPerfil(false) }} />
  }

  return (
    <ModalFormulario
      titulo="Nueva receta"
      subtitulo={`${expediente.folio}${nota ? ' · Vinculada a la nota de consulta' : ''}`}
      ancho={820}
      error={error}
      cerrar={cerrar}
      onSubmit={guardar}
      guardando={guardando}
      textoGuardando="Generando…"
      textoGuardar={sinCedula ? 'Completar perfil médico' : 'Firmar y generar PDF'}
    >
      {alergias.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>
          <BadgeAlergico alergias={alergias} />
          <span style={{ color: '#b91c1c', fontWeight: 600 }}>{alergias.join(', ')}</span>
        </div>
      )}

      {perfil && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748b', marginBottom: 6, flexWrap: 'wrap' }}>
          {sinCedula
            ? <span style={{ color: '#b45309' }}>Para emitir recetas registra tu cédula profesional.</span>
            : <span>Firma: <strong style={{ color: '#1e293b' }}>{perfil.nombre}</strong> · Céd. {perfil.cedula_profesional}{perfil.especialidad ? ` · ${perfil.especialidad}` : ''}{!perfil.firma_base64 && ' · sin firma digital'}</span>}
          <button type="button" style={s.btn('ghost')} onClick={() => setEditarPerfil(true)}>Mi perfil médico</button>
        </div>
      )}

      <div style={s.sect}>Medicamentos</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {medicamentos.map((m, i) => (
          <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, background: '#fcfdfe' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 800, color: '#94a3b8', width: 16 }}>{i + 1}</span>
              <input style={{ ...s.input, flex: 2, fontWeight: 600 }} placeholder="Medicamento (nombre genérico) *" value={m.nombre}
                autoFocus={i === medicamentos.length - 1 && i > 0} onChange={e => setMed(i, 'nombre', e.target.value)} />
              {!esMovil && <input style={{ ...s.input, flex: 1.4 }} placeholder="Presentación: tabletas 500 mg" value={m.presentacion} onChange={e => setMed(i, 'presentacion', e.target.value)} />}
              <button type="button" style={s.btn('ghost')} aria-label="Quitar medicamento" onClick={() => quitar(i)}>×</button>
            </div>
            <div style={{ ...s.grid(120), marginTop: 8, paddingLeft: 24 }}>
              {esMovil && <input style={s.input} placeholder="Presentación" value={m.presentacion} onChange={e => setMed(i, 'presentacion', e.target.value)} />}
              <input style={s.input} placeholder="Dosis: 1 tableta" value={m.dosis} onChange={e => setMed(i, 'dosis', e.target.value)} />
              <input style={s.input} placeholder="Cada 8 horas" value={m.frecuencia} onChange={e => setMed(i, 'frecuencia', e.target.value)} />
              <input style={s.input} placeholder="Por 7 días" value={m.duracion} onChange={e => setMed(i, 'duracion', e.target.value)} />
              <select style={s.input} value={m.via} onChange={e => setMed(i, 'via', e.target.value)}>
                {VIAS.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8, paddingLeft: 24 }}>
              <input style={s.input} placeholder="Indicaciones: tomar con alimentos…" value={m.indicaciones} onChange={e => setMed(i, 'indicaciones', e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" style={{ ...s.btn('ghost'), marginTop: 8 }} onClick={() => setMedicamentos(ms => [...ms, { ...MED_VACIO }])}>
        + Agregar medicamento
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <Campo label="Diagnóstico">
          <input style={s.input} placeholder="CIE-10 y descripción" value={diagnostico} onChange={e => setDiagnostico(e.target.value)} />
        </Campo>
        <Campo label="Indicaciones generales">
          <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }} placeholder="Dieta, reposo, signos de alarma, próxima cita…"
            value={indicaciones} onChange={e => setIndicaciones(e.target.value)} />
        </Campo>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Una receta emitida no se edita; si hay un error, se cancela y se emite otra.</div>
    </ModalFormulario>
  )
}
