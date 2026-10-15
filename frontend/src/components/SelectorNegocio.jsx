import React from 'react'
import { useNegocio } from '../context/NegocioContext'

export default function SelectorNegocio() {
  const { negocioId, setNegocioId, negociosDisponibles } = useNegocio()

  if (negociosDisponibles.length <= 1) return null

  return (
    <select
      value={negocioId}
      onChange={(e) => setNegocioId(e.target.value)}
      style={{ padding: '8px 12px', borderRadius: '8px' }}
    >
      {negociosDisponibles.map((negocio) => (
        <option key={negocio.id} value={negocio.id}>
          {negocio.nombre}
        </option>
      ))}
    </select>
  )
}
