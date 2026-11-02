import { useCallback } from 'react'

// Valores inteligentes para formularios de alta. Son solo una conveniencia:
// si localStorage no está disponible o está vacío, se usan los defaults fijos.

// Recupera el último valor guardado para una clave
export function getLastUsed(key) {
  try { return JSON.parse(localStorage.getItem(`lastUsed_${key}`) ?? 'null') }
  catch { return null }
}

// Guarda el último valor usado (llamar al guardar el formulario con éxito)
export function setLastUsed(key, value) {
  try { localStorage.setItem(`lastUsed_${key}`, JSON.stringify(value)) }
  catch {}
}

// Recientes de clientes (para selectores de cliente en otros formularios)
export function getClientesRecientes() {
  try { return JSON.parse(localStorage.getItem('clientes_recientes') ?? '[]') }
  catch { return [] }
}

export function guardarClienteReciente(cliente) {
  try {
    const id = cliente.id || cliente._id
    const recientes = getClientesRecientes().filter(c => (c.id || c._id) !== id)
    localStorage.setItem('clientes_recientes', JSON.stringify([cliente, ...recientes].slice(0, 5)))
  } catch {}
}

// Toma de `defaults` solo las claves que el formulario realmente tiene.
export function elegirClaves(defaults, claves) {
  return Object.fromEntries(
    Object.entries(defaults).filter(([k]) => claves.includes(k))
  )
}

// Edición: rellena con el default solo los campos que llegan vacíos o nulos
// del servidor. Los valores que ya existen no se tocan.
export function completarVacios(defaults, existente) {
  const resultado = { ...existente }
  for (const [k, v] of Object.entries(defaults)) {
    const actual = resultado[k]
    if (actual === undefined || actual === null || actual === '') resultado[k] = v
  }
  return resultado
}

export function useSmartDefaults() {
  const defaultsCliente = useCallback(() => ({
    pais:                 getLastUsed('cliente_pais')             ?? 'México',
    estado:               getLastUsed('cliente_estado')           ?? 'Estado de México',
    moneda:               getLastUsed('cliente_moneda')           ?? 'MXN',
    regimen_fiscal:       getLastUsed('cliente_regimen_fiscal')   ?? '616',
    uso_cfdi:             getLastUsed('cliente_uso_cfdi')         ?? 'G03',
    forma_pago:           getLastUsed('cliente_forma_pago')       ?? '03',
    condiciones_pago:     getLastUsed('cliente_condiciones_pago') ?? 'Contado',
    limite_credito:       0,
    activo:               true,
    canal_origen:         getLastUsed('cliente_canal_origen')     ?? 'directo',
  }), [])

  const defaultsProducto = useCallback(() => ({
    moneda:               'MXN',
    iva:                  16,
    iva_pct:              16,
    activo:               true,
    unidad_sat:           getLastUsed('producto_unidad_sat')      ?? 'H87',
    tipo:                 getLastUsed('producto_tipo')            ?? 'producto',
    categoria:            getLastUsed('producto_categoria')       ?? null,
    categoria_id:         getLastUsed('producto_categoria')       ?? '',
  }), [])

  return { defaultsCliente, defaultsProducto }
}
