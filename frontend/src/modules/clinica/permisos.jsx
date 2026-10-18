// Permisos de clínica de quien tiene la sesión, en el negocio activo (GET /api/clinica/mis-permisos).
// Solo sirven para ocultar opciones: quien decide es el backend (core/permissions.py).
import { createContext, useContext, useEffect, useState } from 'react'
import { req, qs } from './comun'

const PermisosContext = createContext({ cargado: false, rol: '', puede: () => false })

export function usePermisosClinica(negocioId) {
  const [datos, setDatos] = useState(null)
  useEffect(() => {
    if (!negocioId) return
    let vigente = true
    setDatos(null)
    req(`/api/clinica/mis-permisos?${qs({ negocio_id: negocioId })}`)
      .then(d => { if (vigente) setDatos(d) })
      .catch(() => { if (vigente) setDatos({ rol: '', permisos: [] }) })
    return () => { vigente = false }
  }, [negocioId])

  const permisos = datos?.permisos || []
  const puede = (p) => permisos.includes('*') || permisos.includes(p)
  return {
    cargado: datos !== null,
    rol: datos?.rol || '',
    puede,
    // Laboratorio: sin rol de clínica se conserva el acceso de siempre (igual que el backend)
    puedeLab: (p) => (datos !== null && !datos.rol) || puede(p),
  }
}

export const PermisosProvider = PermisosContext.Provider

export const usePuede = () => useContext(PermisosContext).puede

// Muestra los hijos solo con el permiso
export function SiPuede({ permiso, children }) {
  return usePuede()(permiso) ? children : null
}
