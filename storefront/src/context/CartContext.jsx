import { createContext, useContext, useEffect, useMemo, useState } from 'react'

// Carrito por negocio en localStorage ("cart_{slug}"): cada tienda tiene el suyo.
// Solo guarda referencias; los precios los calcula el servidor al hacer el checkout.
const CartContext = createContext(null)

const clave = (slug) => `cart_${slug}`

function leerCarrito(slug) {
  try {
    const guardado = JSON.parse(localStorage.getItem(clave(slug)) || '[]')
    return Array.isArray(guardado) ? guardado : []
  } catch {
    return []
  }
}

export function CartProvider({ slug, children }) {
  const [items, setItems] = useState(() => leerCarrito(slug))

  useEffect(() => {
    setItems(leerCarrito(slug))
  }, [slug])

  useEffect(() => {
    try {
      localStorage.setItem(clave(slug), JSON.stringify(items))
    } catch {
      // Sin almacenamiento el carrito dura lo que la pestaña
    }
  }, [slug, items])

  const valor = useMemo(() => {
    const agregar = (producto, variante, cantidad = 1) => {
      const id = `${producto.id}:${variante?.id || ''}`
      setItems(prev => {
        const existe = prev.find(i => i.id === id)
        if (existe) return prev.map(i => (i.id === id ? { ...i, cantidad: Math.min(i.cantidad + cantidad, 999) } : i))
        return [...prev, {
          id,
          producto_id: producto.id,
          variante_id: variante?.id || null,
          nombre: variante ? `${producto.nombre} · ${variante.nombre}` : producto.nombre,
          precio: variante?.precio ?? producto.precio ?? null,
          imagen: producto.imagen || null,
          tipo: producto.tipo || 'producto',
          cantidad,
        }]
      })
    }
    const cambiarCantidad = (id, cantidad) => {
      setItems(prev => (cantidad <= 0
        ? prev.filter(i => i.id !== id)
        : prev.map(i => (i.id === id ? { ...i, cantidad: Math.min(cantidad, 999) } : i))))
    }
    const vaciar = () => setItems([])
    const total = items.reduce((acc, i) => acc + (i.precio || 0) * i.cantidad, 0)
    const piezas = items.reduce((acc, i) => acc + i.cantidad, 0)
    return { items, agregar, cambiarCantidad, vaciar, total, piezas }
  }, [items])

  return <CartContext.Provider value={valor}>{children}</CartContext.Provider>
}

export function useCarrito() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCarrito fuera de CartProvider')
  return ctx
}
