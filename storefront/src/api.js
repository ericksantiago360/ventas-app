// Cliente de la API pública de la tienda. No envía token: todo es público.
const BASE = import.meta.env.VITE_API_URL || '/api'

export class ErrorApi extends Error {
  constructor(mensaje, status) {
    super(mensaje)
    this.status = status
  }
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data?.detail
    const mensaje = Array.isArray(d) ? d.map(e => e.msg?.replace(/^Value error, /, '')).join('. ') : d
    throw new ErrorApi(mensaje || 'No se pudo completar la solicitud', res.status)
  }
  return data
}

export const tiendaApi = {
  config: (slug) => pedir(`/tienda/${slug}/config`),
  categorias: (slug) => pedir(`/tienda/${slug}/categorias`),
  productos: (slug, params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null))
    return pedir(`/tienda/${slug}/productos?${qs}`)
  },
  producto: (slug, id) => pedir(`/tienda/${slug}/productos/${id}`),
  checkout: (slug, cuerpo) => pedir(`/tienda/${slug}/checkout`, { method: 'POST', body: JSON.stringify(cuerpo) }),
  estadoOrden: (slug, folio, email) =>
    pedir(`/tienda/${slug}/ordenes/${encodeURIComponent(folio)}?${new URLSearchParams({ email })}`),
}

export const dinero = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n || 0)
