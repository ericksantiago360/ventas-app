import { useEffect } from 'react'

// Pone <meta name="robots" content="noindex"> mientras la página está montada.
// Se usa en checkout y en el estado de orden: son páginas privadas del cliente.
export default function useNoindex() {
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]')
    const creada = !meta
    if (creada) {
      meta = document.createElement('meta')
      meta.name = 'robots'
      document.head.appendChild(meta)
    }
    const anterior = meta.content
    meta.content = 'noindex'
    return () => {
      if (creada) meta.remove()
      else meta.content = anterior
    }
  }, [])
}
