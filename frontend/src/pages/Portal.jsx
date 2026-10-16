import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

// Portal del paciente: sesión independiente del sistema interno (portal_token)
const TOKEN_KEY = 'portal_token'

function leerToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function guardarToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* sin storage */ }
}

class SesionExpirada extends Error {}

async function req(url, opts = {}) {
  const token = leerToken()
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
  })
  if (res.status === 401) throw new SesionExpirada('Tu enlace de acceso venció o ya no es válido. Solicita uno nuevo.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.detail || 'Error en la solicitud')
  return data
}

async function abrirPdf(ordenId) {
  const res = await fetch(`/api/portal/ordenes/${ordenId}/pdf`, { headers: { Authorization: `Bearer ${leerToken()}` } })
  if (res.status === 401) throw new SesionExpirada('Tu enlace de acceso venció. Solicita uno nuevo.')
  if (!res.ok) throw new Error('No se pudo generar el PDF')
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const FLAG_STYLE = {
  normal:   { bg: '#dcfce7', color: '#15803d', label: 'Normal' },
  alto:     { bg: '#fef9c3', color: '#a16207', label: 'Alto ↑' },
  bajo:     { bg: '#dbeafe', color: '#1d4ed8', label: 'Bajo ↓' },
  critico:  { bg: '#fee2e2', color: '#b91c1c', label: 'Fuera de rango' },
  pendiente:{ bg: '#f1f5f9', color: '#94a3b8', label: '—' },
}

const S = {
  page:   { minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui,sans-serif', color: '#1e293b' },
  header: { background: '#1d4ed8', color: '#fff', padding: '16px 16px' },
  wrap:   { maxWidth: 820, margin: '0 auto', padding: '0 16px' },
  card:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '18px 20px' },
  btn:    (v = 'primary') => ({ padding: '9px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, background: v === 'primary' ? '#1d4ed8' : v === 'success' ? '#16a34a' : '#e2e8f0', color: v === 'ghost' ? '#334155' : '#fff' }),
  input:  { width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 15, boxSizing: 'border-box' },
  err:    { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '10px 12px', fontSize: 14, marginBottom: 12 },
  ok:     { background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '10px 12px', fontSize: 14, marginBottom: 12 },
  muted:  { color: '#64748b', fontSize: 13 },
  th:     { textAlign: 'left', padding: '7px 8px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td:     { padding: '9px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 14, verticalAlign: 'top' },
}

function FlagChip({ flag }) {
  const f = FLAG_STYLE[flag] || FLAG_STYLE.pendiente
  return <span style={{ background: f.bg, color: f.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{f.label}</span>
}

// ── /portal/acceso?t=… → guarda el token y entra ─────────────────────────────
export function PortalAcceso() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  useEffect(() => {
    const t = params.get('t')
    if (t) guardarToken(t)
    navigate('/portal', { replace: true })
  }, [])
  return null
}

// ── Solicitar enlace ──────────────────────────────────────────────────────────
function SolicitarAcceso({ aviso }) {
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function enviar(ev) {
    ev.preventDefault()
    setEnviando(true); setError(''); setMsg('')
    try {
      const r = await req('/api/portal/solicitar-acceso', { method: 'POST', body: JSON.stringify({ email }) })
      setMsg(r.mensaje)
    } catch (e) { setError(e.message) }
    finally { setEnviando(false) }
  }

  return (
    <div style={{ ...S.wrap, maxWidth: 440, paddingTop: 48 }}>
      <div style={S.card}>
        <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>Portal del paciente</h1>
        <p style={{ ...S.muted, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
          Consulta y descarga tus resultados de laboratorio. Escribe el correo que registraste en el laboratorio y te enviaremos un enlace de acceso.
        </p>
        {aviso && <div style={S.err}>{aviso}</div>}
        {error && <div style={S.err}>{error}</div>}
        {msg ? <div style={S.ok}>{msg}</div> : (
          <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input style={S.input} type="email" required placeholder="tu@correo.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            <button style={S.btn()} type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviarme un enlace de acceso'}</button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Portal ────────────────────────────────────────────────────────────────────
export default function Portal() {
  const [tieneToken, setTieneToken] = useState(!!leerToken())
  const [aviso, setAviso] = useState('')
  const [yo, setYo] = useState(null)
  const [ordenes, setOrdenes] = useState([])
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const manejarError = useCallback((e) => {
    if (e instanceof SesionExpirada) {
      guardarToken(null); setTieneToken(false); setAviso(e.message)
    } else setError(e.message)
  }, [])

  useEffect(() => {
    if (!tieneToken) return
    setCargando(true)
    Promise.all([req('/api/portal/me'), req('/api/portal/ordenes')])
      .then(([me, ords]) => { setYo(me); setOrdenes(ords) })
      .catch(manejarError)
      .finally(() => setCargando(false))
  }, [tieneToken])

  async function verOrden(id) {
    setError('')
    try { setDetalle(await req(`/api/portal/ordenes/${id}`)) }
    catch (e) { manejarError(e) }
  }

  async function descargar(id) {
    setError('')
    try { await abrirPdf(id) }
    catch (e) { manejarError(e) }
  }

  function salir() {
    guardarToken(null); setTieneToken(false); setYo(null); setOrdenes([]); setDetalle(null); setAviso('')
  }

  const lab = yo?.laboratorio

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={{ ...S.wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 0 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>{lab?.nombre || 'Resultados de laboratorio'}</div>
            {yo && <div style={{ fontSize: 12, opacity: .85 }}>{yo.nombre} · Exp. {yo.folio}</div>}
          </div>
          {tieneToken && <button style={{ ...S.btn('ghost'), background: 'rgba(255,255,255,.15)', color: '#fff' }} onClick={salir}>Salir</button>}
        </div>
      </div>

      {!tieneToken && <SolicitarAcceso aviso={aviso} />}

      {tieneToken && (
        <div style={{ ...S.wrap, paddingTop: 20, paddingBottom: 40 }}>
          {error && <div style={S.err}>{error}</div>}
          {cargando && <div style={S.muted}>Cargando…</div>}

          {/* Lista de órdenes */}
          {!detalle && !cargando && yo && (
            <>
              <h2 style={{ fontSize: 17, margin: '0 0 12px' }}>Mis estudios</h2>
              {ordenes.length === 0 && <div style={{ ...S.card, ...S.muted, textAlign: 'center', padding: 32 }}>Aún no tienes estudios registrados.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ordenes.map(o => (
                  <div key={o.id} style={{ ...S.card, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{o.estudios.join(', ')}</div>
                      <div style={{ ...S.muted, marginTop: 3 }}>
                        {o.fecha} · Orden {o.folio}{o.medico ? ` · ${o.medico}` : ''}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: o.listo ? '#15803d' : '#a16207' }}>
                        {o.listo ? '✓ Resultados listos' : `En proceso · ${o.validados} de ${o.total} estudios listos`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {o.validados > 0 && <button style={S.btn('ghost')} onClick={() => verOrden(o.id)}>Ver</button>}
                      {o.validados > 0 && <button style={S.btn('success')} onClick={() => descargar(o.id)}>PDF</button>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Detalle de orden */}
          {detalle && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button style={S.btn('ghost')} onClick={() => setDetalle(null)}>← Mis estudios</button>
                <div style={{ marginLeft: 'auto' }}>
                  <button style={S.btn('success')} onClick={() => descargar(detalle.id)}>Descargar PDF</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={{ fontWeight: 700 }}>Orden {detalle.folio}</div>
                <div style={S.muted}>{detalle.fecha}{detalle.medico ? ` · Médico: ${detalle.medico}` : ''}</div>
                {detalle.pendientes.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, color: '#a16207' }}>En proceso: {detalle.pendientes.join(', ')}</div>
                )}
              </div>
              {detalle.estudios.map(e => (
                <div key={e.nombre} style={S.card}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{e.nombre}</div>
                  {e.categoria && <div style={{ ...S.muted, fontSize: 12 }}>{e.categoria}</div>}
                  <div style={{ overflowX: 'auto', marginTop: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                      <thead><tr>{['Prueba', 'Resultado', 'Referencia', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {e.analitos.map((a, i) => (
                          <tr key={i}>
                            <td style={S.td}>{a.nombre}</td>
                            <td style={{ ...S.td, fontWeight: 700 }}>{a.valor || '—'} <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>{a.unidad}</span></td>
                            <td style={{ ...S.td, color: '#64748b' }}>{a.referencia || '—'}</td>
                            <td style={S.td}>{!['normal', 'pendiente'].includes(a.flag) && <FlagChip flag={a.flag} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {e.observaciones && <div style={{ ...S.muted, marginTop: 8 }}>Observaciones: {e.observaciones}</div>}
                </div>
              ))}
              <p style={{ ...S.muted, fontSize: 12, textAlign: 'center' }}>
                Los resultados deben ser interpretados por tu médico.
              </p>
            </div>
          )}

          {lab && (lab.telefono || lab.email || lab.direccion) && (
            <div style={{ ...S.muted, fontSize: 12, textAlign: 'center', marginTop: 28 }}>
              {[lab.direccion, lab.telefono, lab.email].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
