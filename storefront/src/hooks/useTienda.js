import { useEffect, useState } from 'react'
import { tiendaApi } from '../api'

// La configuración cambia poco: se guarda en sessionStorage para no pedirla en cada página.
const clave = (slug) => `tienda_cfg_${slug}`

function leerCache(slug) {
  try {
    return JSON.parse(sessionStorage.getItem(clave(slug)) || 'null')
  } catch {
    return null
  }
}

function guardarCache(slug, config) {
  try {
    sessionStorage.setItem(clave(slug), JSON.stringify(config))
  } catch {
    // Modo privado o almacenamiento bloqueado: se pide de nuevo la próxima vez
  }
}

export default function useTienda(slug) {
  const [config, setConfig] = useState(() => leerCache(slug))
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    tiendaApi.config(slug)
      .then(c => { if (vigente) { setConfig(c); setError(''); guardarCache(slug, c) } })
      .catch(e => { if (vigente) setError(e.message) })
    return () => { vigente = false }
  }, [slug])

  return { config, error }
}
