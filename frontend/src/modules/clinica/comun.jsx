// Utilidades compartidas por las páginas del módulo de clínica

export async function req(url, opts = {}) {
  const token = localStorage.getItem('token')
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  if (res.status === 401) {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    window.location.href = '/login'
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Los errores de validación (422) llegan como lista
    const d = data?.detail
    throw new Error(Array.isArray(d) ? d.map(e => e.msg?.replace(/^Value error, /, '')).join('. ') : (d || 'Error en la solicitud'))
  }
  return data
}

export const qs = (params) => new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== '' && v != null)
).toString()

export const nombreCompleto = (p) =>
  p ? [p.nombre, p.apellido_paterno, p.apellido_materno].filter(Boolean).join(' ') : '—'

// El backend responde en UTC; algunas fechas llegan sin zona horaria
export const aFecha = (f) => new Date(/Z$|[+-]\d\d:\d\d$/.test(f) ? f : `${f}Z`)

export const fechaHora = (f) => f
  ? aFecha(f).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  : '—'

export const hora = (f) => aFecha(f).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })

// YYYY-MM-DD del día local (no el de UTC)
export const diaISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const desdeDiaISO = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d) }

export const sumarDias = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r }

export const ZONA = Intl.DateTimeFormat().resolvedOptions().timeZone

export const SEXO_COLOR = {
  masculino: { bg: '#dbeafe', color: '#1d4ed8' },
  femenino:  { bg: '#fce7f3', color: '#9d174d' },
  otro:      { bg: '#f3e8ff', color: '#7e22ce' },
}

export const TIPOS_NOTA = {
  primera_vez:   { label: 'Primera vez',   bg: '#dbeafe', color: '#1d4ed8' },
  seguimiento:   { label: 'Seguimiento',   bg: '#f1f5f9', color: '#475569' },
  urgencia:      { label: 'Urgencia',      bg: '#fee2e2', color: '#b91c1c' },
  interconsulta: { label: 'Interconsulta', bg: '#f3e8ff', color: '#7e22ce' },
}

export function Chip({ texto, bg = '#f1f5f9', color = '#475569' }) {
  return <span style={{ background: bg, color, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{texto}</span>
}

// Badge rojo visible en listas y en la ficha cuando el paciente tiene alergias registradas
export function BadgeAlergico({ alergias }) {
  return (
    <span title={alergias?.length ? `Alergias: ${alergias.join(', ')}` : undefined} style={{
      background: '#dc2626', color: '#fff', borderRadius: 4, padding: '2px 8px',
      fontSize: 11, fontWeight: 800, letterSpacing: '.04em', whiteSpace: 'nowrap',
    }}>
      ALÉRGICO
    </span>
  )
}

export const s = {
  page:   { fontFamily: 'system-ui,sans-serif', color: '#1e293b', maxWidth: 1200 },
  h1:     { fontSize: 22, fontWeight: 700, margin: 0 },
  tabs:   { display: 'flex', gap: 4, marginTop: 20, marginBottom: 20, borderBottom: '2px solid #e2e8f0' },
  tab:    (a) => ({ padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: a ? '#3b82f6' : '#64748b', borderBottom: a ? '2px solid #3b82f6' : '2px solid transparent', marginBottom: -2 }),
  card:   { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '20px 24px' },
  kv:     { fontSize: 11, color: '#94a3b8', marginBottom: 3 },
  btn:    (v = 'primary') => ({ padding: '7px 16px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: v === 'primary' ? '#3b82f6' : v === 'danger' ? '#ef4444' : v === 'ghost' ? '#f1f5f9' : '#22c55e', color: v === 'ghost' ? '#334155' : '#fff' }),
  input:  { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' },
  table:  { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:     { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td:     { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
  grid:   (min = 180) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`, gap: 12 }),
  fg:     { display: 'flex', flexDirection: 'column', gap: 4 },
  lbl:    { fontSize: 12, color: '#64748b' },
  sect:   { fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '16px 0 8px' },
  err:    { background: '#fef2f2', color: '#b91c1c', borderRadius: 6, padding: '8px 12px', fontSize: 13, marginBottom: 12 },
}

export function Campo({ label, children, style }) {
  return (
    <div style={{ ...s.fg, ...style }}>
      <label style={s.lbl}>{label}</label>
      {children}
    </div>
  )
}
