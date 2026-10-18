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

// Página completa: sin el permiso (p. ej. al escribir la dirección a mano) se explica en lugar de mostrar errores
export function RequierePermiso({ permiso, children }) {
  const { cargado, puede } = useContext(PermisosContext)
  if (!cargado) return <div style={{ color: '#94a3b8' }}>Cargando…</div>
  if (puede(permiso)) return children
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '28px 24px', maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b' }}>No tienes acceso a esta sección</div>
      <div style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>
        Tu rol de clínica en este negocio no lo permite. Si lo necesitas, pide a un administrador que lo cambie en Usuarios.
      </div>
    </div>
  )
}

// Muestra los hijos solo con el permiso
export function SiPuede({ permiso, children }) {
  return usePuede()(permiso) ? children : null
}
