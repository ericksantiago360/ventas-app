import { Link } from 'react-router-dom'
import { dinero } from '../api'

// Tarjeta del catálogo. El texto del botón depende de cómo opera la tienda (precio, cotización o propiedades).
export default function ProductCard({ slug, producto, config }) {
  const muestraPrecio = config.mostrar_precio && producto.precio != null
  return (
    <Link to={`/${slug}/producto/${producto.id}`} className="tarjeta">
      <div className="imagen">
        {producto.imagen ? <img src={producto.imagen} alt={producto.nombre} loading="lazy" /> : <span className="muted">Sin imagen</span>}
      </div>
      <h3>{producto.nombre}</h3>
      {muestraPrecio ? <div className="precio">{dinero(producto.precio)}</div> : <div className="muted">Pide cotización</div>}
    </Link>
  )
}
