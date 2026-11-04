import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNegocio } from '../../context/NegocioContext'
import useEsMovil from '../../hooks/useEsMovil'
import EmisorModal from './EmisorModal'
import { req, qs, s, fechaHora, ChipEstado, ESTADOS } from './comun'

const POR_PAGINA = 30

const destinoTexto = (c) => {
  const ultimo = c.destinos[c.destinos.length - 1]
  return `${ultimo?.nombre_destinatario || '—'}${c.destinos.length > 1 ? ` (+${c.destinos.length - 1})` : ''}`
}

export default function CartaPortePage() {
  const { negocioId } = useNegocio()
  const esMovil = useEsMovil()
  const navigate = useNavigate()
  const [filtros, setFiltros] = useState({ estado: '', desde: '', hasta: '', operador_id: '', q: '' })
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState({ items: [], total: 0 })
  const [operadores, setOperadores] = useState([])
  const [alertas, setAlertas] = useState(null)
  const [emisor, setEmisor] = useState(null)
  const [modalEmisor, setModalEmisor] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const setF = (k, v) => { setFiltros(f => ({ ...f, [k]: v })); setPagina(0) }

  useEffect(() => {
    const t = setTimeout(() => setF('q', busqueda.trim()), 300)
    return () => clearTimeout(t)
  }, [busqueda])

  useEffect(() => {
    if (!negocioId) return
    req(`/api/carta-porte/operadores?${qs({ negocio_id: negocioId })}`).then(setOperadores).catch(() => {})
    req(`/api/carta-porte/alertas?${qs({ negocio_id: negocioId })}`).then(setAlertas).catch(() => {})
    req(`/api/carta-porte/emisor?${qs({ negocio_id: negocioId })}`).then(setEmisor).catch(() => {})
  }, [negocioId])

  useEffect(() => {
    if (!negocioId) return
    let vigente = true
    setCargando(true); setError('')
    req(`/api/carta-porte?${qs({ negocio_id: negocioId, ...filtros, skip: pagina * POR_PAGINA, limit: POR_PAGINA })}`)
      .then(d => { if (vigente) setDatos(d) })
      .catch(e => { if (vigente) setError(e.message) })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [negocioId, filtros, pagina])

  const paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA))
  const abrir = (c) => navigate(`/carta-porte/${c.id}`)

  return (
    <div style={s.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1 style={s.h1}>Cartas porte</h1>
          {alertas?.total > 0 && (
            <button onClick={() => navigate(alertas.seguros.length ? '/carta-porte/flota' : '/carta-porte/operadores')} title="Seguros y licencias por vencer"
              style={{ background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              ⚠ {alertas.total} vencimiento{alertas.total > 1 ? 's' : ''}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={s.btn('ghost')} onClick={() => setModalEmisor(true)}>Datos fiscales</button>
          <button style={{ ...s.btn(), whiteSpace: 'nowrap' }} onClick={() => navigate('/carta-porte/nueva')}>+ Nueva carta porte</button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Traslado propio de mercancía. Se timbran ante el SAT cuando están listas para salir.</div>

      {emisor && !emisor.configurado && (
        <div style={{ ...s.err, display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>Antes de la primera carta porte registra los datos fiscales del negocio.</span>
          <button style={s.btn()} onClick={() => setModalEmisor(true)}>Registrar</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, margin: '18px 0 14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...s.input, maxWidth: esMovil ? 'none' : 260, flex: esMovil ? '1 1 100%' : undefined }} placeholder="Folio, destinatario, placa o mercancía…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <select style={{ ...s.input, width: 'auto' }} value={filtros.estado} onChange={e => setF('estado', e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, e]) => <option key={k} value={k}>{e.label}</option>)}
        </select>
        <select style={{ ...s.input, width: 'auto' }} value={filtros.operador_id} onChange={e => setF('operador_id', e.target.value)}>
          <option value="">Todos los operadores</option>
          {operadores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
          Salida del <input type="date" style={{ ...s.input, width: 'auto' }} value={filtros.desde} onChange={e => setF('desde', e.target.value)} />
        </label>
        <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
          al <input type="date" style={{ ...s.input, width: 'auto' }} value={filtros.hasta} onChange={e => setF('hasta', e.target.value)} />
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: '#64748b' }}>{datos.total} documentos</span>
      </div>

      {error && <div style={s.err}>{error}</div>}
      {cargando && !datos.items.length ? <div style={{ color: '#94a3b8', padding: 20 }}>Cargando…</div>
        : !datos.items.length ? (
          <div style={{ ...s.card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: 40 }}>Sin cartas porte para estos filtros</div>
        ) : esMovil ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {datos.items.map(c => (
              <div key={c.id} onClick={() => abrir(c)} style={{ ...s.card, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1d4ed8' }}>{c.folio}</span>
                  <ChipEstado estado={c.estado} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>→ {destinoTexto(c)}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{fechaHora(c.origen.fecha_hora_salida)} · {c.vehiculo_snapshot.placa} · {c.operadores.map(o => o.snapshot.nombre).join(', ')}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...s.card, padding: 0, overflow: 'hidden', opacity: cargando ? 0.6 : 1 }}>
            <table style={s.table}>
              <thead><tr>{['Folio', 'Origen', 'Destino', 'Salida', 'Vehículo', 'Operador', 'Estado'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {datos.items.map(c => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => abrir(c)}>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 700, color: '#1d4ed8' }}>{c.folio}</td>
                    <td style={s.td}>{c.origen.nombre_remitente}<div style={{ fontSize: 11, color: '#94a3b8' }}>C.P. {c.origen.domicilio.codigo_postal}</div></td>
                    <td style={s.td}>{destinoTexto(c)}<div style={{ fontSize: 11, color: '#94a3b8' }}>C.P. {c.destinos[c.destinos.length - 1].domicilio.codigo_postal} · {c.total_dist_rec} km</div></td>
                    <td style={{ ...s.td, fontSize: 12 }}>{fechaHora(c.origen.fecha_hora_salida)}</td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontSize: 12 }}>{c.vehiculo_snapshot.placa}</td>
                    <td style={s.td}>{c.operadores.map(o => o.snapshot.nombre).join(', ')}</td>
                    <td style={s.td}><ChipEstado estado={c.estado} /></td>
                  </tr>
                ))}
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

      {modalEmisor && <EmisorModal negocioId={negocioId} cerrar={() => setModalEmisor(false)} onGuardado={(e) => { setEmisor(e); setModalEmisor(false) }} />}
    </div>
  )
}
