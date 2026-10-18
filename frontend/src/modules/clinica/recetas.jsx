// Lista de recetas compartida por la página de recetas y la pestaña del expediente
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { req, fechaHora, abrirArchivo, s, Chip } from './comun'
import { usePuede } from './permisos'

export const abrirReceta = (r) => abrirArchivo(`/api/clinica/recetas/${r.id}/pdf`)

export function RecetaFila({ r, conPaciente, onCambio }) {
  const puede = usePuede()
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const cancelada = r.estado === 'cancelada'

  async function cancelar() {
    const motivo = window.prompt(`Cancelar la receta ${r.folio}. La farmacia la verá como no válida.\nMotivo:`)
    if (!motivo?.trim()) return
    setOcupado(true); setError('')
    try {
      onCambio(await req(`/api/clinica/recetas/${r.id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) }))
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', opacity: cancelada ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#b91c1c' }}>{r.folio}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{fechaHora(r.fecha)}</span>
            {cancelada && <Chip texto="Cancelada" bg="#fee2e2" color="#b91c1c" />}
          </div>
          {conPaciente && (
            <div style={{ fontSize: 14, marginTop: 3 }}>
              <Link to={`/clinica/expedientes/${r.expediente_id}`} style={{ color: '#1e293b', fontWeight: 600, textDecoration: 'none' }}>
                {r.paciente?.nombre}
              </Link>
              <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginLeft: 8 }}>{r.expediente_folio}</span>
            </div>
          )}
          <div style={{ fontSize: 13, color: '#334155', marginTop: 4 }}>
            {r.medicamentos.map(m => [m.nombre, m.presentacion].filter(Boolean).join(' ')).join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {[r.medico?.nombre && `Dr(a). ${r.medico.nombre}`, r.diagnostico].filter(Boolean).join(' · ')}
          </div>
          {cancelada && r.motivo_cancelacion && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>Motivo: {r.motivo_cancelacion}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={s.btn(cancelada ? 'ghost' : 'primary')} onClick={() => abrirReceta(r).catch(e => setError(e.message))}>
            Imprimir / PDF
          </button>
          {!cancelada && puede('recetas:update') && <button style={{ ...s.btn('ghost'), color: '#b91c1c' }} disabled={ocupado} onClick={cancelar}>Cancelar</button>}
        </div>
      </div>
      {error && <div style={{ ...s.err, marginTop: 8, marginBottom: 0 }}>{error}</div>}
    </div>
  )
}
