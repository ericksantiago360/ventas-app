import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import NuevoExpedienteModal from './NuevoExpedienteModal'
import { req, qs, nombreCompleto, fechaHora, s, Chip, SEXO_COLOR, BadgeAlergico } from './comun'
import { SiPuede } from './permisos'

const POR_PAGINA = 25

function ExpedienteTarjeta({ e, onAbrir }) {
  const p = e.paciente
  return (
    <div onClick={onAbrir} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreCompleto(p)}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            <span style={{ fontFamily: 'monospace' }}>{e.folio}</span>
            {p?.edad ? <> · {p.edad} años</> : null}
          </div>
        </div>
        {e.alergico && <BadgeAlergico alergias={e.antecedentes.alergias} />}
      </div>
      {(e.medico_nombre || p?.telefono) && (
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
          {e.medico_nombre && <div>Dr(a). {e.medico_nombre}</div>}
          {p?.telefono && <div>{p.telefono}</div>}
        </div>
      )}
    </div>
  )
}

export default function ExpedientesPage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const navigate = useNavigate()

  const [busqueda, setBusqueda] = useState('')
  const [q, setQ] = useState('')                    // búsqueda ya aplicada (con retardo)
  const [medicoId, setMedicoId] = useState('')
  const [medicos, setMedicos] = useState([])
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState({ items: [], total: 0 })
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => { setQ(busqueda.trim()); setPagina(0) }, 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!negocioId) return
    req(`/api/clinica/medicos?${qs({ negocio_id: negocioId })}`).then(setMedicos).catch(() => setMedicos([]))
  }, [negocioId])

  useEffect(() => {
    if (!negocioId) return
    let vigente = true
    setCargando(true); setError('')
    req(`/api/clinica/expedientes?${qs({ negocio_id: negocioId, q, medico_id: medicoId, skip: pagina * POR_PAGINA, limit: POR_PAGINA })}`)
      .then(d => { if (vigente) setDatos(d) })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [negocioId, q, medicoId, pagina])

  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA))
  const abrir = (e) => navigate(`/clinica/expedientes/${e.id}`)

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h1 style={s.h1}>Expedientes clínicos</h1>
        <SiPuede permiso="expedientes:create"><button style={s.btn()} onClick={() => setModal(true)}>+ Nuevo paciente</button></SiPuede>
      </div>

      <div style={{ display: 'flex', gap: 10, margin: '20px 0 16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...s.input, maxWidth: esMovil ? 'none' : 340, flex: esMovil ? '1 1 100%' : undefined }}
          placeholder="Buscar por nombre, folio o CURP…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <select style={{ ...s.input, width: 'auto', minWidth: 180 }} value={medicoId}
          onChange={e => { setMedicoId(e.target.value); setPagina(0) }}>
          <option value="">Todos los médicos</option>
          {medicos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>{datos.total} expedientes</span>
      </div>

      {error && <div style={s.err}>{error}</div>}

      {cargando && datos.items.length === 0 ? (
        <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
      ) : esMovil ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {datos.items.length === 0 && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              {q ? 'Sin coincidencias' : 'Aún no hay expedientes'}
            </div>
          )}
          {datos.items.map(e => <ExpedienteTarjeta key={e.id} e={e} onAbrir={() => abrir(e)} />)}
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', opacity: cargando ? 0.6 : 1 }}>
          <table style={s.table}>
            <thead>
              <tr>{['Folio', 'Paciente', 'Edad / Sexo', 'CURP', 'Médico tratante', 'Teléfono', 'Última actividad'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {datos.items.length === 0 && (
                <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 40 }}>
                  {q ? 'Sin coincidencias' : 'Aún no hay expedientes'}
                </td></tr>
              )}
              {datos.items.map(e => {
                const p = e.paciente
                return (
                  <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => abrir(e)}>
                    <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{e.folio}</span></td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{nombreCompleto(p)}</span>
                        {e.alergico && <BadgeAlergico alergias={e.antecedentes.alergias} />}
                      </div>
                    </td>
                    <td style={s.td}>
                      <div>{p?.edad ? `${p.edad} años` : '—'}</div>
                      {p?.sexo && <Chip texto={p.sexo} bg={SEXO_COLOR[p.sexo]?.bg} color={SEXO_COLOR[p.sexo]?.color} />}
                    </td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{p?.curp || '—'}</td>
                    <td style={s.td}>{e.medico_nombre || '—'}</td>
                    <td style={s.td}>{p?.telefono || '—'}</td>
                    <td style={{ ...s.td, fontSize: 12, color: '#94a3b8' }}>{fechaHora(e.updated_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 16, fontSize: 13 }}>
          <button style={s.btn('ghost')} disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
          <span style={{ color: '#64748b' }}>Página {pagina + 1} de {paginas}</span>
          <button style={s.btn('ghost')} disabled={pagina + 1 >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
        </div>
      )}

      {modal && (
        <NuevoExpedienteModal
          negocioId={negocioId}
          cerrar={() => setModal(false)}
          onGuardado={(exp) => { setModal(false); abrir(exp) }}
        />
      )}
    </div>
  )
}
