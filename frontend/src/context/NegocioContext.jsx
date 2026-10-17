import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { negociosApi } from '../api/client'

// Los negocios vienen de GET /api/negocios (config_negocios), ya filtrados a los
// que el usuario tiene asignados. Dar de alta un negocio no requiere tocar código.

const NegocioContext = createContext(null)

export function NegocioProvider({ children }) {
  const [negocios, setNegocios] = useState([])
  const [cargando, setCargando] = useState(Boolean(localStorage.getItem('token')))
  const [error, setError] = useState('')
  const [negocioId, setNegocioIdState] = useState(() => localStorage.getItem('negocio_id') || '')

  useEffect(() => {
    // Sin sesión no hay negocios que pedir; el login recarga la página al entrar
    if (!localStorage.getItem('token')) return
    negociosApi.listar()
      .then(({ data }) => {
        setNegocios(data)
        // El negocio recordado puede no estar asignado a este usuario
        setNegocioIdState(actual => {
          const valido = data.some(n => n.id === actual) ? actual : (data[0]?.id || '')
          if (valido) localStorage.setItem('negocio_id', valido)
          return valido
        })
      })
      .catch(err => setError(err.response?.data?.detail || 'No se pudieron cargar los negocios'))
      .finally(() => setCargando(false))
  }, [])

  const setNegocioId = useCallback((id) => {
    if (!negocios.some(n => n.id === id)) return
    localStorage.setItem('negocio_id', id)
    setNegocioIdState(id)
  }, [negocios])

  const negocioActual = negocios.find(n => n.id === negocioId) || null

  return (
    <NegocioContext.Provider
      value={{
        negocioId,
        setNegocioId,
        negocioActual,
        negociosDisponibles: negocios,
        cargandoNegocios: cargando,
        errorNegocios: error,
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
