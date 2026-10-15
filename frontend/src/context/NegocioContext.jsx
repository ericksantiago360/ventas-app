import React, { createContext, useContext, useState, useCallback } from 'react'

// Debe coincidir con los negocios sembrados en init_db.py (config_negocios).
// Si más adelante agregas un endpoint GET /config-negocios, esto se puede
// reemplazar por un fetch, pero mientras tanto evita otra llamada de red.
const NEGOCIOS_DISPONIBLES = [
  { id: 'santal', nombre: 'Santal Machinery' },
  { id: 'dulce_tentacion', nombre: 'Dulce Tentación' },
  { id: 'bienes_raices', nombre: 'Bienes Raíces' },
  { id: 'diagnostico_plus', nombre: 'Diagnostico Plus Laboratorio Clinico' },
]

const NegocioContext = createContext(null)

function negocioValido(id) {
  return NEGOCIOS_DISPONIBLES.some((n) => n.id === id)
}

export function NegocioProvider({ children, negociosPermitidos }) {
  const lista = negociosPermitidos
    ? NEGOCIOS_DISPONIBLES.filter((n) => negociosPermitidos.includes(n.id))
    : NEGOCIOS_DISPONIBLES

  const [negocioId, setNegocioIdState] = useState(() => {
    const guardado = localStorage.getItem('negocio_id')
    if (guardado && negocioValido(guardado)) return guardado
    return lista[0]?.id || 'santal'
  })

  const setNegocioId = useCallback((id) => {
    if (!negocioValido(id)) return
    localStorage.setItem('negocio_id', id)
    setNegocioIdState(id)
  }, [])

  const negocioActual = lista.find((n) => n.id === negocioId) || lista[0]

  return (
    <NegocioContext.Provider
      value={{
        negocioId,
        setNegocioId,
        negocioActual,
        negociosDisponibles: lista,
      }}
    >
      {children}
    </NegocioContext.Provider>
  )
}

export function useNegocio() {
  const ctx = useContext(NegocioContext)
  if (!ctx) {
    throw new Error('useNegocio() debe usarse dentro de <NegocioProvider>')
  }
  return ctx
}
