import { useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { req, s, Campo, TIPOS_NOTA, BadgeAlergico } from './comun'

const SIGNOS = [
  // clave, etiqueta, unidad, paso del input numérico (null = texto)
  ['tension_arterial',    'T/A',   'mmHg', null],
  ['frecuencia_cardiaca', 'FC',    'lpm',  1],
  ['temperatura',         'Temp.', '°C',   0.1],
  ['peso',                'Peso',  'kg',   0.1],
  ['talla',               'Talla', 'cm',   0.1],
  ['spo2',                'SpO₂',  '%',    1],
]

const SECCIONES = [
  ['subjetivo', 'S — Subjetivo', 'Motivo de consulta, síntomas, padecimiento actual'],
  ['objetivo',  'O — Objetivo',  'Exploración física, hallazgos'],
  ['analisis',  'A — Análisis',  'Impresión diagnóstica, razonamiento clínico'],
  ['plan',      'P — Plan',      'Tratamiento, indicaciones, estudios, próxima cita'],
]

function imc(peso, talla) {
  const p = Number(peso), t = Number(talla) / 100
  return p > 0 && t > 0 ? (p / (t * t)).toFixed(1) : null
}

export default function NuevoNotaSOAPModal({ expediente, cerrar, onGuardada }) {
  const [tipo, setTipo] = useState('seguimiento')
  const [soap, setSoap] = useState({ subjetivo: '', objetivo: '', analisis: '', plan: '' })
  const [signos, setSignos] = useState(Object.fromEntries(SIGNOS.map(([k]) => [k, ''])))
  const [diagnosticos, setDiagnosticos] = useState([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const alergias = expediente.antecedentes?.alergias || []
  const indice = imc(signos.peso, signos.talla)

  function setDx(i, k, v) {
    setDiagnosticos(d => d.map((x, j) => j === i ? { ...x, [k]: v } : x))
  }

  async function guardar(ev) {
    ev.preventDefault()
    if (!Object.values(soap).some(v => v.trim())) { setError('Llena al menos una sección SOAP'); return }
    // Vacíos → null para que el backend no los tome como 0
    const signosVitales = Object.fromEntries(SIGNOS.map(([k, , , paso]) => [
      k, paso === null ? signos[k].trim() : (signos[k] === '' ? null : Number(signos[k])),
    ]))
    setGuardando(true); setError('')
    try {
      const nota = await req(`/api/clinica/expedientes/${expediente.id}/notas`, {
        method: 'POST',
        body: JSON.stringify({
          tipo, ...soap, signos_vitales: signosVitales,
          diagnosticos: diagnosticos.filter(d => d.descripcion.trim()),
        }),
      })
      onGuardada(nota)
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  return (
    <ModalFormulario
      titulo="Nueva nota clínica"
      subtitulo={`${expediente.folio} · Una vez guardada, la nota no se puede modificar`}
      ancho={760}
      error={error}
      cerrar={cerrar}
      onSubmit={guardar}
      guardando={guardando}
      textoGuardar="Firmar y guardar"
    >
      {alergias.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 13 }}>
          <BadgeAlergico alergias={alergias} />
          <span style={{ color: '#b91c1c' }}>{alergias.join(', ')}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(TIPOS_NOTA).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setTipo(k)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: tipo === k ? `2px solid ${t.color}` : '1px solid #e2e8f0',
            background: tipo === k ? t.bg : '#fff', color: tipo === k ? t.color : '#64748b',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={s.sect}>Signos vitales</div>
      <div style={s.grid(100)}>
        {SIGNOS.map(([k, label, unidad, paso]) => (
          <Campo key={k} label={`${label} (${unidad})`}>
            <input style={s.input} value={signos[k]} placeholder={paso === null ? '120/80' : ''}
              type={paso === null ? 'text' : 'number'} step={paso ?? undefined} min={paso === null ? undefined : 0}
              inputMode={paso === null ? 'text' : 'decimal'}
              onChange={e => setSignos(v => ({ ...v, [k]: e.target.value }))} />
          </Campo>
        ))}
      </div>
      {indice && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>IMC: <strong>{indice}</strong></div>}

      <div style={s.sect}>Nota SOAP</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SECCIONES.map(([k, label, ayuda]) => (
          <Campo key={k} label={label}>
            <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }} placeholder={ayuda}
              value={soap[k]} onChange={e => setSoap(v => ({ ...v, [k]: e.target.value }))} />
          </Campo>
        ))}
      </div>

      <div style={s.sect}>Diagnósticos</div>
      {diagnosticos.map((d, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <input style={{ ...s.input, width: 110, flex: 'none' }} placeholder="CIE-10" value={d.cie10}
            autoCapitalize="characters" onChange={e => setDx(i, 'cie10', e.target.value.toUpperCase())} />
          <input style={s.input} placeholder="Descripción" value={d.descripcion} onChange={e => setDx(i, 'descripcion', e.target.value)} />
          <button type="button" style={s.btn('ghost')} aria-label="Quitar"
            onClick={() => setDiagnosticos(diagnosticos.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" style={s.btn('ghost')} onClick={() => setDiagnosticos([...diagnosticos, { cie10: '', descripcion: '' }])}>
        + Agregar diagnóstico
      </button>
    </ModalFormulario>
  )
}
