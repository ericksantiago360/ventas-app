import { useEffect, useState } from 'react'
import ModalFormulario from '../../components/ModalFormulario'
import { useNegocio } from '../../context/NegocioContext'
import FirmaCanvas from './FirmaCanvas'
import PerfilMedicoModal from './PerfilMedicoModal'
import { req, qs, nombreCompleto, s, Campo } from './comun'

const PASOS = ['Documento', 'Firma del paciente', 'Testigos']

// Mismo llenado que el backend; los marcadores desconocidos quedan tal cual
const llenar = (texto, valores) => texto.replace(/\{(\w+)\}/g, (m, k) => (k in valores ? valores[k] : m))

function Firma({ valor, onCambio, alto }) {
  if (valor) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: 8 }}>
          <img src={valor} alt="Firma" style={{ maxHeight: 80, maxWidth: 260, display: 'block' }} />
        </div>
        <button type="button" style={s.btn('ghost')} onClick={() => onCambio('')}>Volver a firmar</button>
      </div>
    )
  }
  return <FirmaCanvas alto={alto} onListo={onCambio} textoListo="Aceptar firma" />
}

// Consentimiento informado para el paciente del expediente. Se llena y se firma en el
// mismo dispositivo (tablet o celular): paciente o representante, y dos testigos.
export default function ConsentimientoModal({ expediente, cerrar, onGuardado }) {
  const { negocioActual } = useNegocio()
  const [paso, setPaso] = useState(0)
  const [plantillas, setPlantillas] = useState([])
  const [perfil, setPerfil] = useState(null)
  const [editarPerfil, setEditarPerfil] = useState(false)

  const [plantillaId, setPlantillaId] = useState('')
  const [tipo, setTipo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [verTexto, setVerTexto] = useState(false)
  const [campos, setCampos] = useState({ procedimiento: '', riesgos: '', beneficios: '', alternativas: '' })

  const [firmante, setFirmante] = useState({ tipo: 'paciente', nombre: '', parentesco: '' })
  const [firmaPaciente, setFirmaPaciente] = useState('')
  const [testigos, setTestigos] = useState([{ nombre: '', firma_base64: '' }, { nombre: '', firma_base64: '' }])

  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    req(`/api/clinica/consentimientos/plantillas?${qs({ negocio_id: expediente.negocio_id })}`).then(ps => {
      setPlantillas(ps)
      if (ps.length) elegir(ps[0])
    }).catch(e => setError(e.message))
    req('/api/clinica/perfil-medico').then(setPerfil).catch(e => setError(e.message))
  }, [])

  function elegir(p) {
    setPlantillaId(p.id); setTipo(p.tipo); setTitulo(p.titulo); setTexto(p.texto)
  }

  const nombrePaciente = nombreCompleto(expediente.paciente)
  const menor = expediente.paciente?.edad > 0 && expediente.paciente.edad < 18
  const nombreFirmante = firmante.tipo === 'representante' ? firmante.nombre : nombrePaciente
  const vistaPrevia = llenar(texto, {
    paciente: nombrePaciente,
    edad: expediente.paciente?.edad ? String(expediente.paciente.edad) : '—',
    firmante: firmante.tipo === 'representante' ? `${firmante.nombre || '[representante]'}${firmante.parentesco ? ` (${firmante.parentesco})` : ''}` : nombrePaciente,
    medico: perfil?.nombre || '', cedula: perfil?.cedula_profesional || '',
    clinica: negocioActual?.nombre || 'la clínica',
    fecha: new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' }),
    procedimiento: campos.procedimiento || '[procedimiento]',
    riesgos: campos.riesgos || '—', beneficios: campos.beneficios || '—', alternativas: campos.alternativas || '—',
  })

  function validar() {
    if (paso === 0) {
      if (perfil && !perfil.cedula_profesional) return 'Registra tu cédula profesional en tu perfil médico'
      if (!titulo.trim() || texto.trim().length < 20) return 'El documento necesita título y texto'
      if (!campos.procedimiento.trim()) return 'Describe el procedimiento que se autoriza'
    }
    if (paso === 1) {
      if (firmante.tipo === 'representante' && (firmante.nombre.trim().length < 3 || !firmante.parentesco.trim())) return 'Indica nombre y parentesco del representante legal'
      if (!firmaPaciente) return `Falta la firma ${firmante.tipo === 'representante' ? 'del representante' : 'del paciente'} (presiona "Aceptar firma")`
    }
    if (paso === 2) {
      if (testigos.some(t => t.nombre.trim().length < 3)) return 'Escribe el nombre completo de los dos testigos'
      if (testigos[0].nombre.trim().toLowerCase() === testigos[1].nombre.trim().toLowerCase()) return 'Los testigos deben ser dos personas distintas'
      if (testigos.some(t => t.nombre.trim().toLowerCase() === nombreFirmante.trim().toLowerCase())) return 'Quien otorga el consentimiento no puede ser testigo'
      if (testigos.some(t => !t.firma_base64)) return 'Faltan firmas de testigos (presiona "Aceptar firma")'
    }
    return ''
  }

  async function enviar(ev) {
    ev.preventDefault()
    const problema = validar()
    if (problema) { setError(problema); return }
    setError('')
    if (paso < PASOS.length - 1) { setPaso(paso + 1); return }
    setGuardando(true)
    try {
      onGuardado(await req('/api/clinica/consentimientos', {
        method: 'POST',
        body: JSON.stringify({
          expediente_id: expediente.id, tipo, titulo, texto, ...campos,
          firmante, firma_paciente_base64: firmaPaciente, testigos,
        }),
      }))
    } catch (e) { setError(e.message) }
    finally { setGuardando(false) }
  }

  if (editarPerfil) {
    return <PerfilMedicoModal cerrar={() => setEditarPerfil(false)} onGuardado={(p) => { setPerfil(p); setEditarPerfil(false) }} />
  }

  const area = (k, label, ph) => (
    <Campo label={label}>
      <textarea style={{ ...s.input, minHeight: 56, resize: 'vertical' }} placeholder={ph} value={campos[k]}
        onChange={e => setCampos(c => ({ ...c, [k]: e.target.value }))} />
    </Campo>
  )
  const setTestigo = (i, k, v) => setTestigos(ts => ts.map((t, j) => j === i ? { ...t, [k]: v } : t))

  return (
    <ModalFormulario
      titulo="Consentimiento informado"
      subtitulo={`${nombrePaciente} · ${expediente.folio} · Paso ${paso + 1} de ${PASOS.length}: ${PASOS[paso]}`}
      ancho={780}
      error={error}
      cerrar={cerrar}
      onSubmit={enviar}
      guardando={guardando}
      textoGuardando="Firmando…"
      textoGuardar={paso < PASOS.length - 1 ? 'Siguiente →' : 'Firmar consentimiento'}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {PASOS.map((nombre, i) => (
          <button key={nombre} type="button" disabled={i > paso} onClick={() => { setError(''); setPaso(i) }} style={{
            flex: 1, padding: '6px 4px', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: i < paso ? 'pointer' : 'default',
            background: i === paso ? '#3b82f6' : i < paso ? '#dbeafe' : '#f1f5f9',
            color: i === paso ? '#fff' : i < paso ? '#1d4ed8' : '#94a3b8',
          }}>{i + 1}. {nombre}</button>
        ))}
      </div>

      {/* ── Paso 1: documento ── */}
      {paso === 0 && (
        <>
          {perfil && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748b', marginBottom: 12, flexWrap: 'wrap' }}>
              {perfil.cedula_profesional
                ? <span>Médico que informa: <strong style={{ color: '#1e293b' }}>{perfil.nombre}</strong> · Céd. {perfil.cedula_profesional}{!perfil.firma_base64 && ' · sin firma digital'}</span>
                : <span style={{ color: '#b45309' }}>El consentimiento lo firma el médico que informa: registra tu cédula.</span>}
              <button type="button" style={s.btn('ghost')} onClick={() => setEditarPerfil(true)}>Mi perfil médico</button>
            </div>
          )}
          <div style={s.grid(220)}>
            <Campo label="Tipo de consentimiento">
              <select style={s.input} value={plantillaId} onChange={e => elegir(plantillas.find(p => p.id === e.target.value))}>
                {plantillas.map(p => <option key={p.id} value={p.id}>{p.titulo}{p.propia ? '' : ' (incluida)'}</option>)}
              </select>
            </Campo>
            <Campo label="Título del documento">
              <input style={s.input} value={titulo} onChange={e => setTitulo(e.target.value)} />
            </Campo>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {area('procedimiento', 'Procedimiento que se autoriza *', 'Nombre y descripción breve del procedimiento')}
            {area('riesgos', 'Riesgos y posibles complicaciones', 'Los que se explicaron al paciente')}
            {area('beneficios', 'Beneficios esperados', '')}
            {area('alternativas', 'Alternativas de tratamiento', '')}
          </div>
          <button type="button" style={{ ...s.btn('ghost'), marginTop: 12 }} onClick={() => setVerTexto(v => !v)}>
            {verTexto ? 'Ocultar texto del documento' : 'Editar texto del documento'}
          </button>
          {verTexto && (
            <Campo label="Texto (los marcadores entre llaves se llenan solos)" style={{ marginTop: 8 }}>
              <textarea style={{ ...s.input, minHeight: 220, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                value={texto} onChange={e => setTexto(e.target.value)} />
            </Campo>
          )}
        </>
      )}

      {/* ── Paso 2: lectura y firma del paciente ── */}
      {paso === 1 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 8 }}>{titulo}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px', maxHeight: 320, overflowY: 'auto' }}>
            {vistaPrevia}
          </div>

          <div style={s.sect}>Quién otorga el consentimiento</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['paciente', 'El paciente'], ['representante', 'Representante legal']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setFirmante(f => ({ ...f, tipo: k })); setFirmaPaciente('') }}
                style={{ ...s.btn(firmante.tipo === k ? 'primary' : 'ghost'), flex: 1 }}>{l}</button>
            ))}
          </div>
          {menor && firmante.tipo === 'paciente' && (
            <div style={{ fontSize: 12, color: '#b45309', marginTop: 6 }}>El paciente es menor de edad: normalmente firma su madre, padre o tutor.</div>
          )}
          {firmante.tipo === 'representante' && (
            <div style={{ ...s.grid(200), marginTop: 10 }}>
              <Campo label="Nombre completo del representante *">
                <input style={s.input} value={firmante.nombre} onChange={e => setFirmante(f => ({ ...f, nombre: e.target.value }))} autoCapitalize="words" />
              </Campo>
              <Campo label="Parentesco o calidad legal *">
                <input style={s.input} placeholder="Madre, padre, tutor…" value={firmante.parentesco} onChange={e => setFirmante(f => ({ ...f, parentesco: e.target.value }))} />
              </Campo>
            </div>
          )}
          <div style={{ ...s.lbl, margin: '12px 0 6px' }}>Firma de {nombreFirmante || 'el representante'}</div>
          <Firma valor={firmaPaciente} onCambio={setFirmaPaciente} alto={170} />
        </>
      )}

      {/* ── Paso 3: testigos ── */}
      {paso === 2 && (
        <>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
            La NOM-004 pide el nombre y la firma de dos testigos. No pueden ser quien otorga el consentimiento.
          </div>
          {testigos.map((t, i) => (
            <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12, background: '#fcfdfe' }}>
              <Campo label={`Testigo ${i + 1}: nombre completo *`}>
                <input style={s.input} value={t.nombre} onChange={e => setTestigo(i, 'nombre', e.target.value)} autoCapitalize="words" />
              </Campo>
              <div style={{ ...s.lbl, margin: '10px 0 6px' }}>Firma</div>
              <Firma valor={t.firma_base64} onCambio={v => setTestigo(i, 'firma_base64', v)} alto={130} />
            </div>
          ))}
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Al firmar se registran la fecha, la hora y la dirección IP. El documento firmado ya no se puede modificar; solo revocar.
          </div>
        </>
      )}

      {paso > 0 && (
        <button type="button" style={{ ...s.btn('ghost'), marginTop: 14 }} onClick={() => { setError(''); setPaso(paso - 1) }}>← Atrás</button>
      )}
    </ModalFormulario>
  )
}
