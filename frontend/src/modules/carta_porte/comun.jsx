// Utilidades del módulo de Carta Porte (reusa las de clínica: req, estilos, Campo…)
import { useEffect, useRef, useState } from 'react'
import { req, qs, s, Campo, Chip, aFecha, fechaHora, diaISO } from '../clinica/comun'

export { req, qs, s, Campo, Chip, aFecha, fechaHora, diaISO }
export { abrirArchivo } from '../clinica/comun'

export const ESTADOS = {
  borrador:    { label: 'Borrador',    bg: '#f1f5f9', color: '#475569' },
  listo:       { label: 'Listo',       bg: '#dbeafe', color: '#1d4ed8' },
  en_transito: { label: 'En tránsito', bg: '#fef3c7', color: '#b45309' },
  entregado:   { label: 'Entregado',   bg: '#dcfce7', color: '#15803d' },
  cancelado:   { label: 'Cancelado',   bg: '#fee2e2', color: '#b91c1c' },
}

export const FLUJO = ['borrador', 'listo', 'en_transito', 'entregado']

export function ChipEstado({ estado }) {
  const e = ESTADOS[estado] || ESTADOS.borrador
  return <Chip texto={e.label} bg={e.bg} color={e.color} />
}

// Avisa a la barra lateral que cambiaron vencimientos (badge de alertas)
export const avisarCambioFlota = () => window.dispatchEvent(new Event('carta-porte:cambio'))

// Catálogos chicos del SAT: se piden una vez por sesión
let catalogosCache = null
export function useCatalogos() {
  const [cat, setCat] = useState(catalogosCache)
  useEffect(() => {
    if (catalogosCache) return
    req('/api/carta-porte/catalogos').then(c => { catalogosCache = c; setCat(c) }).catch(() => {})
  }, [])
  return cat
}

export const descripcion = (lista, clave) => lista?.find(x => x.clave === clave)?.descripcion || ''

// "2026-10-20T08:00" (input datetime-local) ↔ fecha guardada en UTC
export const aInputFecha = (iso) => {
  if (!iso) return ''
  const d = aFecha(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export const desdeInputFecha = (v) => v ? new Date(v).toISOString() : ''

export const diasHasta = (fecha) => Math.round((new Date(`${fecha}T00:00:00`) - new Date(new Date().toDateString())) / 86400000)

// Aviso de vencimiento (seguro o licencia) cuando faltan 30 días o menos
export function ChipVence({ fecha, que }) {
  if (!fecha) return null
  const dias = diasHasta(fecha)
  if (dias > 30) return null
  const texto = dias < 0 ? `${que} vencido` : dias === 0 ? `${que} vence hoy` : `${que} vence en ${dias} día${dias === 1 ? '' : 's'}`
  return <Chip texto={texto} bg={dias < 0 ? '#fee2e2' : '#fef3c7'} color={dias < 0 ? '#b91c1c' : '#b45309'} />
}

export const DOMICILIO_VACIO = { calle: '', num_exterior: '', num_interior: '', colonia: '', codigo_postal: '', referencia: '' }

// Domicilio con claves SAT: el código postal da estado y municipio, y la lista de colonias
export function DomicilioForm({ valor, onChange }) {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  // La consulta del C.P. responde después: debe partir del domicilio más reciente, no del de
  // cuando se lanzó, o borraría lo que el usuario escribió mientras tanto
  const actual = useRef(valor)
  actual.current = valor
  const set = (k, v) => onChange({ ...valor, [k]: v })

  useEffect(() => {
    const cp = (valor.codigo_postal || '').trim()
    if (!/^\d{5}$/.test(cp)) { setInfo(null); setError(''); return }
    let vigente = true
    req(`/api/carta-porte/catalogos/codigo-postal/${cp}`)
      .then(d => {
        if (!vigente) return
        setInfo(d); setError('')
        // Con una sola colonia se elige sola; si la elegida no es de este CP, se limpia
        const v = actual.current
        if (d.colonias.length === 1 && v.colonia !== d.colonias[0].clave) onChange({ ...v, colonia: d.colonias[0].clave })
        else if (v.colonia && !d.colonias.some(c => c.clave === v.colonia)) onChange({ ...v, colonia: '' })
      })
      .catch(e => { if (vigente) { setInfo(null); setError(e.message) } })
    return () => { vigente = false }
  }, [valor.codigo_postal])

  return (
    <div>
      <div style={s.grid(150)}>
        <Campo label="Código postal *">
          <input style={s.input} inputMode="numeric" maxLength={5} value={valor.codigo_postal}
            onChange={e => onChange({ ...valor, codigo_postal: e.target.value.replace(/\D/g, ''), estado: '', municipio: '', localidad: '' })}
            placeholder="44100" />
        </Campo>
        <Campo label="Colonia">
          <select style={s.input} value={valor.colonia} disabled={!info?.colonias.length} onChange={e => set('colonia', e.target.value)}>
            <option value="">{info ? (info.colonias.length ? '—' : 'Sin colonias en el catálogo') : 'Escribe el C.P.'}</option>
            {info?.colonias.map(c => <option key={c.clave} value={c.clave}>{c.descripcion}</option>)}
          </select>
        </Campo>
        <Campo label="Calle">
          <input style={s.input} value={valor.calle} onChange={e => set('calle', e.target.value)} />
        </Campo>
        <Campo label="Núm. exterior">
          <input style={s.input} value={valor.num_exterior} onChange={e => set('num_exterior', e.target.value)} />
        </Campo>
        <Campo label="Núm. interior">
          <input style={s.input} value={valor.num_interior} onChange={e => set('num_interior', e.target.value)} />
        </Campo>
      </div>
      <div style={{ fontSize: 12, marginTop: 6, color: error ? '#b91c1c' : '#64748b' }}>
        {error || (info ? `${info.municipio_nombre}, ${info.estado_nombre}` : 'El estado y el municipio se toman del código postal (catálogo del SAT).')}
      </div>
    </div>
  )
}

export const textoDomicilio = (d) => [
  [d.calle, d.num_exterior, d.num_interior && `int. ${d.num_interior}`].filter(Boolean).join(' '),
  `C.P. ${d.codigo_postal}`,
].filter(Boolean).join(', ')
