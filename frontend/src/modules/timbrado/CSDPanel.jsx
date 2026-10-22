import { useEffect, useState } from 'react'

// Certificado de Sello Digital del negocio: subir (.cer + .key + contraseña), ver vigencia y revocar.
// Solo lo usa la administración de negocios; el backend exige rol admin para subir o revocar.

const s = {
  card:  { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
  label: { fontSize: 12, color: '#64748b', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  row2:  { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12, marginTop: 12 },
  btn:   { padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#3b82f6', color: '#fff' },
  ghost: { padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: '#f1f5f9', color: '#b91c1c' },
  err:   { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginTop: 12 },
  ok:    { background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginTop: 12 },
}

const ESTADO = {
  sin:      { label: 'Sin CSD',       bg: '#f1f5f9', color: '#475569' },
  activo:   { label: 'CSD activo',    bg: '#dcfce7', color: '#15803d' },
  pronto:   { label: 'Vence pronto',  bg: '#fef3c7', color: '#b45309' },
  vencido:  { label: 'CSD vencido',   bg: '#fee2e2', color: '#b91c1c' },
}

const fecha = (iso) => new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })

function estadoDe(csd) {
  if (!csd) return ESTADO.sin
  if (csd.vencido) return ESTADO.vencido
  return csd.vence_pronto ? ESTADO.pronto : ESTADO.activo
}

async function llamar(url, opts = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'No se pudo completar la operación')
  return data
}

export default function CSDPanel({ negocioId }) {
  const [csd, setCsd] = useState(undefined)     // undefined: cargando; null: sin CSD
  const [cer, setCer] = useState(null)
  const [key, setKey] = useState(null)
  const [contrasena, setContrasena] = useState('')
  const [formVersion, setFormVersion] = useState(0)   // reinicia los inputs de archivo
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    setCsd(undefined); setError(''); setMensaje('')
    llamar(`/api/timbrado/csd?negocio_id=${encodeURIComponent(negocioId)}`)
      .then(setCsd)
      .catch(e => setError(e.message))
  }, [negocioId])

  async function subir(ev) {
    ev.preventDefault()
    if (!cer || !key) { setError('Selecciona el archivo .cer y el archivo .key'); return }
    const datos = new FormData()
    datos.append('negocio_id', negocioId)
    datos.append('contrasena', contrasena)
    datos.append('archivo_cer', cer)
    datos.append('archivo_key', key)
    setOcupado(true); setError(''); setMensaje('')
    try {
      const nuevo = await llamar('/api/timbrado/csd', { method: 'POST', body: datos })
      setCsd(nuevo)
      setCer(null); setKey(null); setContrasena(''); setFormVersion(v => v + 1)
      setMensaje('CSD guardado. El certificado anterior quedó archivado.')
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  async function revocar() {
    if (!csd || !window.confirm('¿Revocar el CSD? Sin un CSD activo no se pueden timbrar facturas ni cartas porte.')) return
    setOcupado(true); setError(''); setMensaje('')
    try {
      await llamar(`/api/timbrado/csd/${csd.id}`, { method: 'DELETE' })
      setCsd(null)
      setMensaje('CSD revocado')
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }

  if (csd === undefined && !error) return <div style={s.card}>Cargando certificado…</div>

  const estado = estadoDe(csd)
  return (
    <div style={s.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700 }}>Certificado fiscal (CSD)</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Firma las facturas y cartas porte antes de timbrarlas ante el SAT. La llave privada se guarda cifrada.
          </div>
        </div>
        <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: estado.bg, color: estado.color }}>
          {estado.label}
        </span>
      </div>

      {csd && (
        <div style={{ fontSize: 13, marginTop: 12 }}>
          No. de certificado <span style={{ fontFamily: 'monospace' }}>{csd.no_certificado}</span> · RFC {csd.rfc_emisor} · vigente hasta <b>{fecha(csd.fecha_fin_vigencia)}</b>
        </div>
      )}

      <form onSubmit={subir} style={{ marginTop: 16 }} key={formVersion}>
        <div style={s.row2}>
          <div>
            <label style={s.label}>Certificado (.cer)</label>
            <input style={s.input} type="file" accept=".cer" onChange={e => setCer(e.target.files[0] || null)} />
          </div>
          <div>
            <label style={s.label}>Llave privada (.key)</label>
            <input style={s.input} type="file" accept=".key" onChange={e => setKey(e.target.files[0] || null)} />
          </div>
          <div>
            <label style={s.label}>Contraseña de la llave</label>
            <input style={s.input} type="password" autoComplete="new-password" required value={contrasena}
              onChange={e => setContrasena(e.target.value)} />
          </div>
        </div>

        {error && <div style={s.err}>{error}</div>}
        {mensaje && <div style={s.ok}>{mensaje}</div>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          {csd && <button type="button" style={s.ghost} disabled={ocupado} onClick={revocar}>Revocar</button>}
          <button type="submit" style={s.btn} disabled={ocupado}>
            {ocupado ? 'Guardando…' : csd ? 'Reemplazar CSD' : 'Subir CSD'}
          </button>
        </div>
      </form>
    </div>
  )
}
