import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import NuevaCitaModal from './NuevaCitaModal'
import { req, qs, hora, diaISO, desdeDiaISO, sumarDias, capitalizar, ZONA, s, BadgeAlergico } from './comun'
import { ESTADOS_CITA, TIPOS_CITA, ChipEstado, AccionesCita } from './citas'
import { usePuede } from './permisos'

function CitaFila({ c, onCambio, onReprogramar }) {
  const est = ESTADOS_CITA[c.estado] || ESTADOS_CITA.programada
  const apagada = ['cancelada', 'no_show', 'atendida'].includes(c.estado)
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderLeft: `4px solid ${est.borde}`, borderRadius: 10,
      padding: '12px 14px', display: 'flex', gap: 14, opacity: apagada ? 0.7 : 1,
    }}>
      <div style={{ width: 52, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{hora(c.fecha_inicio)}</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{c.duracion_minutos} min</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 15, textDecoration: c.estado === 'cancelada' ? 'line-through' : 'none' }}>
            {c.paciente_nombre || 'Paciente'}
          </span>
          {c.alergias?.length > 0 && <BadgeAlergico alergias={c.alergias} />}
          <ChipEstado estado={c.estado} />
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 3 }}>
          {[TIPOS_CITA[c.tipo], c.medico_nombre && `Dr(a). ${c.medico_nombre}`, c.consultorio].filter(Boolean).join(' · ')}
        </div>
        {c.motivo && <div style={{ fontSize: 13, marginTop: 4 }}>{c.motivo}</div>}
        {c.notas_recepcion && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.notas_recepcion}</div>}
        <div style={{ marginTop: 10 }}>
          <AccionesCita cita={c} onCambio={onCambio} onReprogramar={onReprogramar} compacto />
        </div>
      </div>
    </div>
  )
}

export default function AgendaDiaPage() {
  const puede = usePuede()
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const fecha = params.get('fecha') || diaISO(new Date())
  const esHoy = fecha === diaISO(new Date())

  const [medicoId, setMedicoId] = useState('')
  const [medicos, setMedicos] = useState([])
  const [citas, setCitas] = useState([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)      // { cita? }

  const irA = (dia) => setParams(dia === diaISO(new Date()) ? {} : { fecha: dia }, { replace: true })

  useEffect(() => {
    if (!negocioId) return
    req(`/api/clinica/medicos?${qs({ negocio_id: negocioId })}`).then(setMedicos).catch(() => setMedicos([]))
  }, [negocioId])

  const cargar = () => {
    setCargando(true); setError('')
    return req(`/api/clinica/citas/hoy?${qs({ negocio_id: negocioId, fecha, medico_id: medicoId, tz: ZONA })}`)
      .then(setCitas).catch(e => setError(e.message)).finally(() => setCargando(false))
  }
  useEffect(() => { if (negocioId) cargar() }, [negocioId, fecha, medicoId])

  // La agenda del día se mantiene al corriente sola (recepción la deja abierta)
  useEffect(() => {
    if (!esHoy) return
    const t = setInterval(() => { if (!document.hidden) cargar() }, 60_000)
    return () => clearInterval(t)
  }, [esHoy, negocioId, fecha, medicoId])

  const reemplazar = (nueva) => setCitas(cs => cs.map(c => c.id === nueva.id ? nueva : c))
  const conteo = Object.fromEntries(Object.keys(ESTADOS_CITA).map(k => [k, citas.filter(c => c.estado === k).length]))
  const titulo = capitalizar(desdeDiaISO(fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }))

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={s.h1}>{esHoy ? 'Agenda de hoy' : 'Agenda del día'}</h1>
          <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>{titulo}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!esMovil && <button style={s.btn('ghost')} onClick={() => navigate('/clinica/agenda')}>Vista semanal</button>}
          {puede('citas:create') && <button style={s.btn()} onClick={() => setModal({})}>+ Nueva cita</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={s.btn('ghost')} aria-label="Día anterior" onClick={() => irA(diaISO(sumarDias(desdeDiaISO(fecha), -1)))}>←</button>
        <button style={s.btn('ghost')} disabled={esHoy} onClick={() => irA(diaISO(new Date()))}>Hoy</button>
        <button style={s.btn('ghost')} aria-label="Día siguiente" onClick={() => irA(diaISO(sumarDias(desdeDiaISO(fecha), 1)))}>→</button>
        <input type="date" style={{ ...s.input, width: 'auto' }} value={fecha} onChange={e => e.target.value && irA(e.target.value)} />
        <select style={{ ...s.input, width: 'auto', minWidth: 170, flex: esMovil ? '1 1 100%' : undefined }} value={medicoId} onChange={e => setMedicoId(e.target.value)}>
          <option value="">Todos los médicos</option>
          {medicos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      {citas.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {Object.entries(ESTADOS_CITA).filter(([k]) => conteo[k]).map(([k, e]) => (
            <span key={k} style={{ background: e.bg, color: e.color, borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>
              {e.label}: {conteo[k]}
            </span>
          ))}
        </div>
      )}

      {error && <div style={s.err}>{error}</div>}

      {cargando && citas.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
      ) : citas.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>Sin citas este día</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {citas.map(c => <CitaFila key={c.id} c={c} onCambio={reemplazar} onReprogramar={() => setModal({ cita: c })} />)}
        </div>
      )}

      {modal && (
        <NuevaCitaModal
          negocioId={negocioId}
          cita={modal.cita}
          dia={fecha}
          cerrar={() => setModal(null)}
          onGuardada={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}
