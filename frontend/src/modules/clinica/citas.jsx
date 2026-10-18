// Estados, colores y acciones de las citas, compartidos por la agenda semanal y la del día
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useEsMovil from '../../hooks/useEsMovil'
import { req, hora, fechaHora, s, Chip, BadgeAlergico } from './comun'

export const ESTADOS_CITA = {
  programada:  { label: 'Programada',  bg: '#e0f2fe', color: '#0369a1', borde: '#38bdf8' },
  confirmada:  { label: 'Confirmada',  bg: '#dcfce7', color: '#15803d', borde: '#22c55e' },
  en_consulta: { label: 'En consulta', bg: '#fef3c7', color: '#b45309', borde: '#f59e0b' },
  atendida:    { label: 'Atendida',    bg: '#f1f5f9', color: '#475569', borde: '#94a3b8' },
  cancelada:   { label: 'Cancelada',   bg: '#fef2f2', color: '#b91c1c', borde: '#fca5a5' },
  no_show:     { label: 'No asistió',  bg: '#f5f3ff', color: '#6d28d9', borde: '#a78bfa' },
}

export const TIPOS_CITA = {
  primera_vez:   'Primera vez',
  seguimiento:   'Seguimiento',
  urgencia:      'Urgencia',
  procedimiento: 'Procedimiento',
}

export const FINALES = ['atendida', 'cancelada']

export function ChipEstado({ estado }) {
  const e = ESTADOS_CITA[estado] || ESTADOS_CITA.programada
  return <Chip texto={e.label} bg={e.bg} color={e.color} />
}

// Botones según el estado. "Iniciar consulta" abre el expediente para escribir la nota.
export function AccionesCita({ cita, onCambio, onReprogramar, compacto }) {
  const navigate = useNavigate()
  const esMovil = useEsMovil()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  async function cambiar(estado, irAlExpediente = false) {
    setOcupado(true); setError('')
    try {
      const nueva = await req(`/api/clinica/citas/${cita.id}`, { method: 'PUT', body: JSON.stringify({ estado }) })
      onCambio(nueva)
      if (irAlExpediente) navigate(`/clinica/expedientes/${cita.expediente_id}`)
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  async function cancelar() {
    const motivo = window.prompt(`Cancelar la cita ${cita.folio} de ${cita.paciente_nombre}.\nMotivo (opcional):`)
    if (motivo === null) return
    setOcupado(true); setError('')
    try {
      onCambio(await req(`/api/clinica/citas/${cita.id}?motivo=${encodeURIComponent(motivo)}`, { method: 'DELETE' }))
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  const e = cita.estado
  const botones = [
    e === 'programada' && ['Confirmar', 'success', () => cambiar('confirmada')],
    ['programada', 'confirmada'].includes(e) && ['Iniciar consulta', 'primary', () => cambiar('en_consulta', true)],
    e === 'en_consulta' && ['Abrir expediente', 'primary', () => navigate(`/clinica/expedientes/${cita.expediente_id}`)],
    e === 'en_consulta' && ['Atendida', 'success', () => cambiar('atendida')],
    e === 'no_show' && ['Reactivar', 'ghost', () => cambiar('programada')],
    ['programada', 'confirmada'].includes(e) && ['No asistió', 'ghost', () => cambiar('no_show')],
    !FINALES.includes(e) && onReprogramar && ['Reprogramar', 'ghost', onReprogramar],
    !FINALES.includes(e) && ['Cancelar', 'ghost', cancelar],
  ].filter(Boolean)

  if (!botones.length) return null
  return (
    <div onClick={ev => ev.stopPropagation()}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {botones.map(([texto, variante, accion]) => (
          <button key={texto} disabled={ocupado} onClick={accion} style={{
            ...s.btn(variante),
            ...(compacto ? { padding: '5px 10px', fontSize: 12 } : {}),
            ...(esMovil ? { padding: '9px 12px', fontSize: 13 } : {}),
            ...(texto === 'Cancelar' ? { color: '#b91c1c' } : {}),
          }}>{texto}</button>
        ))}
      </div>
      {error && <div style={{ ...s.err, marginTop: 8, marginBottom: 0 }}>{error}</div>}
    </div>
  )
}

// Detalle de una cita al tocarla en el calendario
export function CitaDetalleModal({ cita, cerrar, onCambio, onReprogramar }) {
  const est = ESTADOS_CITA[cita.estado] || ESTADOS_CITA.programada
  const fila = (label, valor) => valor ? (
    <div style={{ display: 'flex', gap: 12, fontSize: 14, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ color: '#94a3b8', width: 110, flexShrink: 0 }}>{label}</span>
      <span style={{ whiteSpace: 'pre-wrap' }}>{valor}</span>
    </div>
  ) : null

  return (
    <div onClick={e => e.target === e.currentTarget && cerrar()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', borderTop: `4px solid ${est.borde}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{cita.paciente_nombre || 'Paciente'}</h2>
              {cita.alergias?.length > 0 && <BadgeAlergico alergias={cita.alergias} />}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              {hora(cita.fecha_inicio)}–{hora(cita.fecha_fin)} · <span style={{ fontFamily: 'monospace' }}>{cita.folio}</span>
            </div>
          </div>
          <button onClick={cerrar} aria-label="Cerrar" style={{ ...s.btn('ghost'), fontSize: 18, lineHeight: 1, padding: '2px 10px' }}>×</button>
        </div>

        <div style={{ margin: '14px 0' }}>
          {fila('Estado', <ChipEstado estado={cita.estado} />)}
          {fila('Fecha', fechaHora(cita.fecha_inicio))}
          {fila('Duración', `${cita.duracion_minutos} min`)}
          {fila('Tipo', TIPOS_CITA[cita.tipo])}
          {fila('Médico', cita.medico_nombre)}
          {fila('Consultorio', cita.consultorio)}
          {fila('Expediente', cita.expediente_folio)}
          {fila('Teléfono', cita.paciente_telefono && <a href={`tel:${cita.paciente_telefono}`}>{cita.paciente_telefono}</a>)}
          {fila('Motivo', cita.motivo)}
          {fila('Recepción', cita.notas_recepcion)}
          {fila('Cancelación', cita.motivo_cancelacion)}
        </div>

        <AccionesCita cita={cita} onCambio={onCambio} onReprogramar={onReprogramar} />
      </div>
    </div>
  )
}
