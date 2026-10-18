import { useEffect, useState } from 'react'

export const ANCHO_MOVIL = 768

// true en pantallas de celular; se actualiza al girar el teléfono o cambiar el tamaño
export default function useEsMovil() {
  const consulta = `(max-width: ${ANCHO_MOVIL}px)`
  const [esMovil, setEsMovil] = useState(() => window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const cambio = (e) => setEsMovil(e.matches)
    mq.addEventListener('change', cambio)
    return () => mq.removeEventListener('change', cambio)
  }, [consulta])
  return esMovil
}
