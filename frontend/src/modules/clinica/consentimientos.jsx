// Fila de consentimiento compartida por la página de consentimientos y la pestaña del expediente
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { req, fechaHora, abrirArchivo, s, Chip } from './comun'
import { usePuede } from './permisos'

export function ConsentimientoFila({ c, conPaciente, onCambio }) {
  const puede = usePuede()
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const revocado = c.estado === 'revocado'

  async function revocar() {
    const motivo = window.prompt(`Revocar el consentimiento ${c.folio} (${c.procedimiento}).\nMotivo que expresa el paciente:`)
    if (!motivo?.trim()) return
    setOcupado(true); setError('')
    try { onCambio(await req(`/api/clinica/consentimientos/${c.id}/revocar`, { method: 'POST', body: JSON.stringify({ motivo }) })) }
    catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', opacity: revocado ? 0.75 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#475569' }}>{c.folio}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{fechaHora(c.fecha_firma)}</span>
            {revocado ? <Chip texto="Revocado" bg="#fee2e2" color="#b91c1c" /> : <Chip texto="Firmado" bg="#dcfce7" color="#15803d" />}
          </div>
          {conPaciente && (
            <div style={{ fontSize: 14, marginTop: 3 }}>
              <Link to={`/clinica/expedientes/${c.expediente_id}`} style={{ color: '#1e293b', fontWeight: 600, textDecoration: 'none' }}>{c.paciente?.nombre}</Link>
              <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginLeft: 8 }}>{c.expediente_folio}</span>
            </div>
          )}
          <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>{c.titulo} · <strong>{c.procedimiento}</strong></div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {c.firmante?.tipo === 'representante' ? `Firmó ${c.firmante.nombre} (${c.firmante.parentesco})` : 'Firmó el paciente'}
            {' · '}Dr(a). {c.medico?.nombre} · Testigos: {c.testigos?.map(t => t.nombre).join(', ')}
          </div>
          {revocado && c.revocacion && (
            <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>Revocado el {fechaHora(c.revocacion.fecha)}: {c.revocacion.motivo}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={s.btn(revocado ? 'ghost' : 'primary')} onClick={() => abrirArchivo(`/api/clinica/consentimientos/${c.id}/pdf`).catch(e => setError(e.message))}>
            PDF
          </button>
          {!revocado && puede('consentimientos:update') && <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} disabled={ocupado} onClick={revocar}>Revocar</button>}
        </div>
      </div>
      {error && <div style={{ ...s.err, marginTop: 8, marginBottom: 0 }}>{error}</div>}
    </div>
  )
}
