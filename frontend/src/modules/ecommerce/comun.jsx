// Utilidades del módulo Tienda en línea (reusa los estilos y el cliente de clínica)
import { req, qs, s, Campo, Chip } from '../clinica/comun'

export { req, qs, s, Campo, Chip }

export const mxn = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0)

export const ESTADOS_ORDEN = {
  pendiente_pago:   { label: 'Pendiente de pago', bg: '#fef3c7', color: '#b45309' },
  solicitud:        { label: 'Solicitud',         bg: '#e0e7ff', color: '#4338ca' },
  pago_en_revision: { label: 'Pago en revisión',  bg: '#dbeafe', color: '#1d4ed8' },
  confirmada:       { label: 'Confirmada',        bg: '#dcfce7', color: '#15803d' },
  cancelada:        { label: 'Cancelada',         bg: '#fee2e2', color: '#b91c1c' },
}

export const TIPOS_ORDEN = {
  producto:   'Producto',
  servicio:   'Servicio',
  cotizacion: 'Cotización',
  contacto:   'Contacto',
}

export function ChipOrden({ estado }) {
  const e = ESTADOS_ORDEN[estado] || ESTADOS_ORDEN.pendiente_pago
  return <Chip texto={e.label} bg={e.bg} color={e.color} />
}

// Subida de imágenes: multipart, así que no pasa por req() (que fuerza JSON)
export async function subirImagen(negocioId, tipo, archivo) {
  const body = new FormData()
  body.append('archivo', archivo)
  const res = await fetch(`/api/admin/tienda/${tipo}?${qs({ negocio_id: negocioId })}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.detail || 'No se pudo subir la imagen')
  return data
}

// Quita logo o banner de la tienda (y su archivo en disco)
export async function quitarImagen(negocioId, tipo) {
  const res = await fetch(`/api/admin/tienda/${tipo}?${qs({ negocio_id: negocioId })}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.detail || 'No se pudo quitar la imagen')
  return data
}

// El backend manda fechas en UTC; sin zona se tratan como UTC
const aDate = (iso) => new Date(/Z$|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`)

export const fechaLocal = (iso) => (iso ? aDate(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '')

export const minutosDesde = (iso) => {
  const diff = Math.max(0, Date.now() - aDate(iso).getTime())
  const min = Math.floor(diff / 60000)
  if (min < 60) return `hace ${min} min`
  if (min < 60 * 24) return `hace ${Math.floor(min / 60)} h`
  return `hace ${Math.floor(min / 1440)} d`
}
