import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import NuevaCitaModal from './NuevaCitaModal'
import AgendaDiaPage from './AgendaDiaPage'
import { req, qs, hora, aFecha, diaISO, sumarDias, capitalizar, s } from './comun'
import { ESTADOS_CITA, CitaDetalleModal } from './citas'
import { usePuede } from './permisos'

const PX_HORA = 56
const HORAS_DEFECTO = [7, 21]
const ANCHO_HORAS = 52

function lunesDe(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}

const minutosDelDia = (d) => d.getHours() * 60 + d.getMinutes()

// Citas encimadas en la misma columna se reparten el ancho
function acomodar(citas) {
  const orden = [...citas].sort((a, b) => a._ini - b._ini || b._fin - a._fin)
  const resultado = []
  let grupo = [], finGrupo = -1
  const cerrarGrupo = () => {
    const carriles = []
    for (const c of grupo) {
      let i = carriles.findIndex(fin => fin <= c._ini)
      if (i === -1) { i = carriles.length; carriles.push(0) }
      carriles[i] = c._fin
      c._carril = i
    }
    grupo.forEach(c => resultado.push({ ...c, _carriles: carriles.length }))
  }
  for (const c of orden) {
    if (grupo.length && c._ini >= finGrupo) { cerrarGrupo(); grupo = []; finGrupo = -1 }
    grupo.push(c); finGrupo = Math.max(finGrupo, c._fin)
  }
  if (grupo.length) cerrarGrupo()
  return resultado
}

function Evento({ c, desdeHora, semana, onClick }) {
  const est = ESTADOS_CITA[c.estado] || ESTADOS_CITA.programada
  const top = (c._ini - desdeHora * 60) / 60 * PX_HORA
  const alto = Math.max(18, (c._fin - c._ini) / 60 * PX_HORA - 2)
  const ancho = 100 / c._carriles
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} title={`${hora(c.fecha_inicio)} ${c.paciente_nombre}`} style={{
      position: 'absolute', top, height: alto, left: `calc(${c._carril * ancho}% + 2px)`, width: `calc(${ancho}% - 4px)`,
      background: est.bg, color: est.color, border: 'none', borderLeft: `3px solid ${est.borde}`, borderRadius: 5,
      padding: '2px 5px', textAlign: 'left', cursor: 'pointer', overflow: 'hidden', fontFamily: 'inherit',
      opacity: ['cancelada', 'no_show'].includes(c.estado) ? 0.6 : 1, boxSizing: 'border-box',
      boxShadow: '0 1px 2px rgba(15,23,42,.08)', zIndex: 2,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: c.estado === 'cancelada' ? 'line-through' : 'none' }}>
        {c.alergias?.length > 0 && <span style={{ color: '#dc2626' }} title="Alérgico">● </span>}
        {hora(c.fecha_inicio)} {c.paciente_nombre}
      </div>
      {alto > 32 && (
        <div style={{ fontSize: 10.5, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {[semana && c.medico_nombre, c.consultorio].filter(Boolean).join(' · ') || c.motivo}
        </div>
      )}
    </button>
  )
}

export default function AgendaPage() {
  const esMovil = useEsMovil()
  // En celular siete columnas no caben: se usa la agenda del día
  return esMovil ? <AgendaDiaPage /> : <AgendaSemana />
}

function AgendaSemana() {
  const puede = usePuede()
  const { negocioId } = useNegocio()
  const navigate = useNavigate()
  const [vista, setVista] = useState('semana')        // 'semana' | 'dia' (columnas por médico)
  const [referencia, setReferencia] = useState(() => new Date())
  const [medicoId, setMedicoId] = useState('')
  const [verCanceladas, setVerCanceladas] = useState(false)
  const [medicos, setMedicos] = useState([])
  const [citas, setCitas] = useState([])
  const [error, setError] = useState('')
  const [nueva, setNueva] = useState(null)            // { inicio, medicoId } | { cita } para reprogramar
  const [detalle, setDetalle] = useState(null)
  const [ahora, setAhora] = useState(() => new Date())

  const inicio = vista === 'semana' ? lunesDe(referencia) : new Date(referencia.getFullYear(), referencia.getMonth(), referencia.getDate())
  const fin = sumarDias(inicio, vista === 'semana' ? 7 : 1)

  useEffect(() => {
    if (!negocioId) return
    req(`/api/clinica/medicos?${qs({ negocio_id: negocioId })}`).then(setMedicos).catch(() => setMedicos([]))
  }, [negocioId])

  const cargar = () => req(`/api/clinica/citas?${qs({
    negocio_id: negocioId, desde: inicio.toISOString(), hasta: fin.toISOString(), medico_id: medicoId,
  })}`).then(c => { setCitas(c); setError('') }).catch(e => setError(e.message))

  useEffect(() => { if (negocioId) cargar() }, [negocioId, inicio.getTime(), vista, medicoId])

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const visibles = useMemo(() => citas
    .filter(c => verCanceladas || !['cancelada', 'no_show'].includes(c.estado))
    .map(c => {
      const i = aFecha(c.fecha_inicio), f = aFecha(c.fecha_fin)
      return { ...c, _dia: diaISO(i), _ini: minutosDelDia(i), _fin: Math.max(minutosDelDia(i) + 5, diaISO(f) === diaISO(i) ? minutosDelDia(f) : 24 * 60) }
    }), [citas, verCanceladas])

  // Columnas: los 7 días, o un médico por columna en la vista de día
  const columnas = useMemo(() => {
    if (vista === 'semana') {
      return Array.from({ length: 7 }, (_, i) => {
        const d = sumarDias(inicio, i)
        return { clave: diaISO(d), dia: d, medicoId, titulo: capitalizar(d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })) }
      })
    }
    const conCitas = new Set(visibles.map(c => c.medico_id))
    let lista = medicoId ? medicos.filter(m => m.id === medicoId) : medicos.filter(m => conCitas.has(m.id))
    if (!lista.length) lista = medicos
    return lista.map(m => ({ clave: m.id, dia: inicio, medicoId: m.id, titulo: m.nombre }))
  }, [vista, inicio.getTime(), medicos, visibles, medicoId])

  const citasDe = (col) => acomodar(visibles.filter(c =>
    vista === 'semana' ? c._dia === col.clave : c._dia === diaISO(inicio) && c.medico_id === col.medicoId))

  // El horario se amplía si hay citas fuera de 7:00–21:00
  const desdeHora = Math.min(HORAS_DEFECTO[0], ...visibles.map(c => Math.floor(c._ini / 60)))
  const hastaHora = Math.max(HORAS_DEFECTO[1], ...visibles.map(c => Math.ceil(c._fin / 60)))
  const horas = Array.from({ length: hastaHora - desdeHora }, (_, i) => desdeHora + i)

  function clicHueco(ev, col) {
    const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top
    const minutos = desdeHora * 60 + Math.floor((y / PX_HORA * 60) / 15) * 15
    const d = new Date(col.dia.getFullYear(), col.dia.getMonth(), col.dia.getDate(), Math.floor(minutos / 60), minutos % 60)
    setNueva({ inicio: d, medicoId: col.medicoId })
  }

  const mover = (n) => setReferencia(r => sumarDias(r, n * (vista === 'semana' ? 7 : 1)))
  const titulo = vista === 'semana'
    ? `${inicio.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${sumarDias(fin, -1).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : capitalizar(inicio.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
  const hoyISO = diaISO(ahora)
  const lineaAhora = (minutosDelDia(ahora) - desdeHora * 60) / 60 * PX_HORA
  const reemplazar = (c) => { setCitas(cs => cs.map(x => x.id === c.id ? c : x)); setDetalle(c) }

  return (
    <div style={{ ...s.page, maxWidth: 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={s.h1}>Agenda</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btn('ghost')} onClick={() => navigate('/clinica/agenda/dia')}>Lista del día</button>
          {puede('citas:create') && <button style={s.btn()} onClick={() => setNueva({})}>+ Nueva cita</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button style={s.btn('ghost')} aria-label="Anterior" onClick={() => mover(-1)}>←</button>
        <button style={s.btn('ghost')} onClick={() => setReferencia(new Date())}>Hoy</button>
        <button style={s.btn('ghost')} aria-label="Siguiente" onClick={() => mover(1)}>→</button>
        <span style={{ fontWeight: 600, fontSize: 15, marginLeft: 6 }}>{titulo}</span>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={verCanceladas} onChange={e => setVerCanceladas(e.target.checked)} /> Canceladas
          </label>
          <select style={{ ...s.input, width: 'auto', minWidth: 170 }} value={medicoId} onChange={e => setMedicoId(e.target.value)}>
            <option value="">Todos los médicos</option>
            {medicos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 6, padding: 2 }}>
            {[['semana', 'Semana'], ['dia', 'Día por médico']].map(([k, l]) => (
              <button key={k} onClick={() => setVista(k)} style={{
                border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: vista === k ? '#fff' : 'transparent', color: vista === k ? '#1e293b' : '#64748b',
                boxShadow: vista === k ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
              }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto', maxHeight: 'calc(100vh - 190px)' }}>
        <div style={{ minWidth: ANCHO_HORAS + columnas.length * 120 }}>
          {/* Encabezados */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
            <div style={{ width: ANCHO_HORAS, flexShrink: 0 }} />
            {columnas.map(col => {
              const esHoy = vista === 'semana' && col.clave === hoyISO
              return (
                <button key={col.clave} disabled={vista !== 'semana'}
                  onClick={() => { setReferencia(col.dia); setVista('dia') }}
                  title={vista === 'semana' ? 'Ver el día por médico' : undefined}
                  style={{
                    flex: 1, minWidth: 120, padding: '8px 4px', border: 'none', borderLeft: '1px solid #f1f5f9', background: 'none',
                    fontSize: 13, fontWeight: 600, color: esHoy ? '#1d4ed8' : '#334155',
                    cursor: vista === 'semana' ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontFamily: 'inherit',
                  }}>
                  {esHoy ? <span style={{ background: '#1d4ed8', color: '#fff', borderRadius: 12, padding: '2px 10px' }}>{col.titulo}</span> : col.titulo}
                </button>
              )
            })}
          </div>

          {/* Cuadrícula */}
          <div style={{ display: 'flex', position: 'relative' }}>
            <div style={{ width: ANCHO_HORAS, flexShrink: 0 }}>
              {horas.map(h => (
                <div key={h} style={{ height: PX_HORA, fontSize: 11, color: '#94a3b8', textAlign: 'right', paddingRight: 8, transform: 'translateY(-7px)', fontVariantNumeric: 'tabular-nums' }}>
                  {h > desdeHora ? `${String(h).padStart(2, '0')}:00` : ''}
                </div>
              ))}
            </div>
            {columnas.map(col => {
              const esHoy = diaISO(col.dia) === hoyISO
              return (
                <div key={col.clave} onClick={puede('citas:create') ? (e) => clicHueco(e, col) : undefined} style={{
                  flex: 1, minWidth: 120, position: 'relative', borderLeft: '1px solid #f1f5f9', cursor: puede('citas:create') ? 'copy' : 'default',
                  height: horas.length * PX_HORA,
                  background: `repeating-linear-gradient(to bottom, transparent 0, transparent ${PX_HORA / 2 - 1}px, #f8fafc ${PX_HORA / 2 - 1}px, #f8fafc ${PX_HORA / 2}px, transparent ${PX_HORA / 2}px, transparent ${PX_HORA - 1}px, #e2e8f0 ${PX_HORA - 1}px, #e2e8f0 ${PX_HORA}px)`,
                }}>
                  {citasDe(col).map(c => (
                    <Evento key={c.id} c={c} desdeHora={desdeHora} semana={vista === 'semana'} onClick={() => setDetalle(c)} />
                  ))}
                  {esHoy && lineaAhora >= 0 && lineaAhora <= horas.length * PX_HORA && (
                    <div style={{ position: 'absolute', left: 0, right: 0, top: lineaAhora, borderTop: '2px solid #ef4444', zIndex: 3, pointerEvents: 'none' }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {puede('citas:create') && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Haz clic en un horario vacío para agendar ahí.</div>}

      {detalle && (
        <CitaDetalleModal
          cita={detalle}
          cerrar={() => setDetalle(null)}
          onCambio={reemplazar}
          onReprogramar={() => { setNueva({ cita: detalle }); setDetalle(null) }}
        />
      )}
      {nueva && (
        <NuevaCitaModal
          negocioId={negocioId}
          cita={nueva.cita}
          inicio={nueva.inicio}
          medicoId={nueva.medicoId}
          cerrar={() => setNueva(null)}
          onGuardada={() => { setNueva(null); cargar() }}
        />
      )}
    </div>
  )
}
