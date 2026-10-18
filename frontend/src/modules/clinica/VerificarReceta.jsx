import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

// Página pública (sin sesión) a la que lleva el QR de la receta, para farmacias
export default function VerificarReceta() {
  const { folio } = useParams()
  const [r, setR] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/clinica/recetas/verificar/${encodeURIComponent(folio)}`)
      .then(async res => {
        if (res.status === 404) throw new Error('No existe una receta con este código. Puede ser falsa o estar mal escrita.')
        if (!res.ok) throw new Error('No se pudo verificar la receta. Intenta de nuevo.')
        setR(await res.json())
      })
      .catch(e => setError(e.message))
  }, [folio])

  const valida = r?.valida
  const color = !r ? '#64748b' : valida ? '#15803d' : '#b91c1c'

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui,sans-serif', color: '#1e293b', padding: '24px 16px' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 10 }}>
          Verificación de receta
        </div>

        {error && (
          <div style={{ background: '#fff', border: '2px solid #fecaca', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#b91c1c' }}>Receta no encontrada</div>
            <div style={{ fontSize: 14, color: '#475569', marginTop: 6 }}>{error}</div>
          </div>
        )}
        {!r && !error && <div style={{ color: '#94a3b8' }}>Verificando…</div>}

        {r && (
          <div style={{ background: '#fff', border: `2px solid ${valida ? '#bbf7d0' : '#fecaca'}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ background: valida ? '#f0fdf4' : '#fef2f2', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span aria-hidden="true" style={{
                width: 36, height: 36, borderRadius: 999, background: color, color: '#fff', fontSize: 20, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>{valida ? '✓' : '✕'}</span>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, color }}>{valida ? 'Receta válida' : 'Receta cancelada'}</div>
                <div style={{ fontSize: 13, color: '#475569' }}>
                  {valida ? 'Emitida por la clínica y vigente.' : `No debe surtirse.${r.motivo_cancelacion ? ` Motivo: ${r.motivo_cancelacion}` : ''}`}
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 20px' }}>
              {[
                ['Folio', <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{r.folio}</span>],
                ['Fecha', new Date(r.fecha).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })],
                ['Clínica', r.clinica],
                ['Médico', r.medico.nombre],
                ['Cédula', r.medico.cedula_profesional],
                ['Especialidad', r.medico.especialidad || 'Médico general'],
                ['Paciente', r.paciente_iniciales],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                  <span style={{ color: '#94a3b8', width: 100, flexShrink: 0 }}>{k}</span>
                  <span>{v}</span>
                </div>
              ))}

              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 6px' }}>
                Medicamentos prescritos
              </div>
              {r.medicamentos.map((m, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.nombre} <span style={{ fontWeight: 400, color: '#64748b' }}>{m.presentacion}</span></div>
                  <div style={{ fontSize: 13, color: '#475569' }}>{[m.dosis, m.frecuencia, m.duracion, m.via].filter(Boolean).join(' · ')}</div>
                </div>
              ))}
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 14 }}>
                Compara estos datos con la receta impresa. Si no coinciden, no la surtas.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
